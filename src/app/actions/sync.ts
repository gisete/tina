"use server";

import { auth } from "@/auth";
import { db } from "@/db/client";
import { sleepSessions, heartRateSummaries, heartRateSamples, syncState } from "@/db/schema";
import {
  fetchGoogleSleepData,
  fetchGoogleHeartData,
  fetchGoogleHeartRateSamples,
} from "@/lib/google/client";
import {
  normalizeGoogleSleepSessions,
  normalizeHeartData,
  normalizeHeartRateSamples,
} from "@/lib/google/normalizers";
import { persistHealthRecords, persistHeartRateSamples } from "@/lib/sync/persist";
import { assembleDashboardData } from "@/lib/sync/assemble";
import { selectMainSessions, buildDebtHistory, calculateSleepDebt } from "@/lib/analytics/sleep";
import { localToday, addDays } from "@/lib/dates";
import { eq, and, asc, desc, gte, lt, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * How many days back to fetch from Google on each sync. Older sessions are
 * settled data that won't change; only the reconciliation window needs
 * refreshing on every call.
 */
const RECONCILE_WINDOW_DAYS = 3;

/**
 * Hours before the last sync is considered stale enough to trigger an
 * automatic background sync on the today view.
 */
const STALE_AFTER_HOURS = 6;

/**
 * Minimum cached samples before a night is considered fully populated.
 * Below this, we attempt a Google fetch on first read.
 */
const MIN_NIGHT_SAMPLES = 10;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SAMPLE HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensures the heart_rate_samples cache is populated for the given session.
 * Returns cached samples immediately when the cache is warm (≥ MIN_NIGHT_SAMPLES).
 * On a cold cache, fetches from Google once, persists permanently, and returns
 * the fresh samples.
 *
 * This is a deliberate, narrow exception to the read/sync split: it fires at
 * most once per night ever (permanently cached after first view), only for the
 * single session being displayed, and only when samples are genuinely absent.
 * Don't remove this Google call in the name of "reads don't hit Google" —
 * that rule is about avoiding full syncs on every navigation, not about
 * blocking lazy one-off population of permanent cache entries.
 *
 * Sample queries key on session start_time/end_time (timestamps), not
 * sleep_date, so results are unaffected by any historical sleep_date mis-keying
 * from before the nightOf() fix.
 */
async function ensureNightSamples(
  userId: string,
  session: { startTime: Date; endTime: Date },
): Promise<Array<{ timestamp: Date; bpm: number }>> {
  const sampleQuery = () =>
    db.query.heartRateSamples.findMany({
      where: and(
        eq(heartRateSamples.userId, userId),
        gte(heartRateSamples.timestamp, session.startTime),
        lte(heartRateSamples.timestamp, session.endTime),
      ),
      orderBy: [asc(heartRateSamples.timestamp)],
    });

  const cached = await sampleQuery();
  if (cached.length >= MIN_NIGHT_SAMPLES) return cached;

  try {
    const raw = await fetchGoogleHeartRateSamples(
      userId,
      session.startTime.toISOString(),
      session.endTime.toISOString(),
    );
    const normalized = normalizeHeartRateSamples(userId, raw);
    if (normalized.length > 0) {
      await persistHeartRateSamples(normalized);
      console.log(`[sync] Fetched ${normalized.length} heart-rate samples for ${session.startTime.toISOString()}`);
      return sampleQuery();
    }
  } catch (err) {
    console.warn(
      "[sync] HR samples fetch failed (continuing):",
      err instanceof Error ? err.message : err,
    );
  }

  return cached;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ PATH — no Google calls except ensureNightSamples (see above)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads existing DB rows and assembles analytics. No Google calls are made.
 * Also returns `lastSyncedAt` (ISO string) so the UI can show sync freshness.
 *
 * Sessions are stored under the date the night STARTED; a selected day shows
 * the night the user woke from that morning — hence strictly-before (`lt`).
 * Calendar-day metrics (heart summaries) include the day itself (`lte`).
 */
export async function readDashboardData(targetDate?: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  const [historicalSessions, historicalHeartRows, currentStateRows, syncRow] = await Promise.all([
    db.query.sleepSessions.findMany({
      where: targetDate
        ? and(eq(sleepSessions.userId, userId), lt(sleepSessions.sleepDate, targetDate))
        : eq(sleepSessions.userId, userId),
      orderBy: [desc(sleepSessions.sleepDate)],
      limit: 90,
      with: { stages: true },
    }),
    db.query.heartRateSummaries.findMany({
      where: targetDate
        ? and(eq(heartRateSummaries.userId, userId), lte(heartRateSummaries.date, targetDate))
        : eq(heartRateSummaries.userId, userId),
      orderBy: [desc(heartRateSummaries.date)],
      limit: 45,
    }),
    // When browsing a past date, fetch the truly-latest sessions so
    // currentState.debt and currentState.variance always reflect today.
    targetDate
      ? db.query.sleepSessions.findMany({
          where: eq(sleepSessions.userId, userId),
          orderBy: [desc(sleepSessions.sleepDate)],
          limit: 30,
        })
      : Promise.resolve(null),
    db.query.syncState.findFirst({
      where: eq(syncState.userId, userId),
    }),
  ]);

  // Surface night HR samples for the displayed session, fetching from Google
  // once if the cache is sparse. See ensureNightSamples for the rationale.
  let nightSamples: Array<{ timestamp: Date; bpm: number }> = [];
  const displayedSession = selectMainSessions(historicalSessions)[0];
  if (displayedSession) {
    nightSamples = await ensureNightSamples(userId, displayedSession);
  }

  const assembled = assembleDashboardData(
    historicalSessions,
    historicalHeartRows.map((r) => ({
      date: r.date,
      restingHeartRate: r.restingHeartRate,
      hrvRmssd: r.hrvRmssd,
    })),
    nightSamples,
    8,
    currentStateRows ?? undefined,
  );

  return {
    ...assembled,
    lastSyncedAt: syncRow?.lastSyncedAt?.toISOString() ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC PATH — fetches from Google, persists, updates the sync clock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches sessions from Google Health, normalizes, persists (upsert on
 * startTime), and fills the HR sample cache for the most recent night if
 * sparse. Returns void — callers re-read via readDashboardData after this.
 *
 * @param days - How many days back to fetch. Defaults to RECONCILE_WINDOW_DAYS
 *   (3). Pass a wider value only for DB recovery / first-time backfill; normal
 *   page loads and the Sync button always use the default.
 */
export async function syncFromGoogle({ days = RECONCILE_WINDOW_DAYS }: { days?: number } = {}): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - days);
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  const [sleepResult, heartResult] = await Promise.allSettled([
    fetchGoogleSleepData(userId, startISO, endISO),
    fetchGoogleHeartData(userId, startISO, endISO),
  ]);

  if (sleepResult.status === "rejected") throw sleepResult.reason;
  if (heartResult.status === "rejected") {
    console.warn(
      "[sync] Heart data fetch failed (continuing):",
      heartResult.reason?.message ?? heartResult.reason
    );
  }
  const rawHeartData = heartResult.status === "fulfilled" ? heartResult.value : null;

  const normalizedSleep = normalizeGoogleSleepSessions(userId, sleepResult.value);
  const heartRecords = rawHeartData
    ? normalizeHeartData(userId, rawHeartData.heartRatePoints, rawHeartData.hrvPoints)
    : [];

  console.log(
    `[sync] Normalized: ${normalizedSleep.length} sleep sessions, ${heartRecords.length} heart records`
  );

  if (process.env.SYNC_DEBUG === "1") {
    for (const { session: s } of normalizedSleep) {
      console.log(
        `[sync:debug] normalized  startTime=${s.startTime.toISOString()}  sleepDate=${s.sleepDate}`
      );
    }
  }

  await persistHealthRecords(userId, normalizedSleep, heartRecords);

  // Populate the HR sample cache for the most-recent main session if sparse.
  const recentSessions = await db.query.sleepSessions.findMany({
    where: eq(sleepSessions.userId, userId),
    orderBy: [desc(sleepSessions.sleepDate)],
    limit: 5,
  });
  const mainSession = selectMainSessions(recentSessions)[0];
  if (mainSession) {
    await ensureNightSamples(userId, mainSession);
  }

  // Stamp the sync clock so the staleness guard knows when we last ran.
  await db
    .insert(syncState)
    .values({ userId, lastSyncedAt: new Date() })
    .onConflictDoUpdate({
      target: syncState.userId,
      set: { lastSyncedAt: sql`NOW()` },
    });

  // Invalidate server-side page caches so the next navigation gets fresh data.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/sleep");
  revalidatePath("/dashboard/heart");
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE HELPER — staleness guard + read in one call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single entry point for dashboard pages. On the today view, checks
 * whether the last sync is older than STALE_AFTER_HOURS and runs a Google
 * sync if so. Browsing past dates (any targetDate ≠ today) never triggers
 * a sync — historical data is served from cache only.
 */
export async function loadPageData(targetDate?: string) {
  const authSession = await auth();
  if (!authSession?.user?.id) throw new Error("Unauthorized");
  const userId = authSession.user.id;

  const isToday = !targetDate || targetDate === localToday();
  if (isToday) {
    const syncRow = await db.query.syncState.findFirst({
      where: eq(syncState.userId, userId),
    });
    const staleMs = STALE_AFTER_HOURS * 60 * 60 * 1000;
    const isStale =
      !syncRow?.lastSyncedAt ||
      Date.now() - syncRow.lastSyncedAt.getTime() > staleMs;
    if (isStale) {
      try {
        await syncFromGoogle();
      } catch (err) {
        // Auto-sync failure is non-fatal — render whatever is in cache.
        console.error(
          "[sync] Auto-sync failed — rendering cached data:",
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  return readDashboardData(targetDate);
}

// ─────────────────────────────────────────────────────────────────────────────
// SLEEP DEBT DETAIL PAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches up to 90 days of main sleep sessions from the DB and returns the
 * full debt history timeline for the /dashboard/sleep/debt detail page.
 */
export async function fetchDebtSessions(daysBack: number = 90) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized: You must be logged in.");
  const userId = session.user.id;

  const startDate = addDays(localToday(), -daysBack);

  const rows = await db.query.sleepSessions.findMany({
    where: and(
      eq(sleepSessions.userId, userId),
      gte(sleepSessions.sleepDate, startDate),
    ),
    orderBy: [asc(sleepSessions.sleepDate)],
  });

  const mainSessions = selectMainSessions(rows).map((s) => ({
    sleepDate: s.sleepDate,
    startTime: s.startTime,
    endTime: s.endTime,
    totalSleepMs: s.totalSleepMs,
    efficiencyScore: s.efficiencyScore,
  }));

  const history = buildDebtHistory(mainSessions);
  const summary = calculateSleepDebt(mainSessions);

  return {
    history,
    currentDebtHours: summary.cumulativeDebtHours,
    currentSeverity: summary.severity,
  };
}
