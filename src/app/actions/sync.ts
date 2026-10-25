"use server";

import { auth } from "@/auth";
import { db } from "@/db/client";
import { sleepSessions, heartRateSummaries, syncState } from "@/db/schema";
import { runSyncStep } from "@/lib/sync/step";
import { ensureNightSamples } from "@/lib/sync/night-samples";
import { assembleDashboardData } from "@/lib/sync/assemble";
import { selectMainSessions, buildDebtHistory, calculateSleepDebt, resolveSelectedNight, toSelectedNightView } from "@/lib/analytics/sleep";
import { localToday, addDays } from "@/lib/dates";
import { eq, and, asc, desc, gte, lt, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// ─────────────────────────────────────────────────────────────────────────────
// READ PATH — no Google calls except ensureNightSamples (see src/lib/sync/night-samples.ts)
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
    // When browsing a past date, fetch the truly-latest sessions (with stages)
    // so currentState.debt/variance and the Sleep Score Trend always reflect today.
    targetDate
      ? db.query.sleepSessions.findMany({
          where: eq(sleepSessions.userId, userId),
          orderBy: [desc(sleepSessions.sleepDate)],
          limit: 90,
          with: { stages: true },
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
    currentStateRows ?? undefined,
  );

  // Which night the picked date implies, and whether it is actually recorded.
  // Plain primitives only: this crosses the server→client boundary.
  const today = localToday();
  const resolved = resolveSelectedNight({ sessions: historicalSessions, selectedDate: targetDate ?? today, today });
  const selectedNight = toSelectedNightView(resolved);

  return {
    ...assembled,
    selectedNight,
    lastSyncedAt: syncRow?.lastSyncedAt?.toISOString() ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC PATH — Sync button action
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Server action: one forced recent-window sync step followed by dashboard
 * cache invalidation (the Sync button). Wider manual ranges go through
 * /api/sync?days=N (src/lib/sync/range-sync.ts).
 *
 * Call ONLY from non-render contexts. revalidatePath is unsupported during
 * render, so render-time callers must NOT call this; the layout-level
 * <CatchUpSync> client component fires the sync post-render where
 * revalidatePath is legal.
 */
export async function syncFromGoogle(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const result = await runSyncStep(session.user.id, { force: true });
  if (result.kind === "auth_required") throw new Error("Google sign-in expired. Please reconnect.");
  if (result.kind === "error") throw new Error(result.message);
  // busy: another step is already syncing; nothing to do.

  // Invalidate server-side page caches so the next navigation gets fresh data.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/sleep");
  revalidatePath("/dashboard/heart");
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single entry point for dashboard pages. Reads Postgres and computes
 * analytics — no Google calls (bar the cached night-sample fill), no DB
 * writes, no revalidatePath. Render-safe. Syncing is the layout-level
 * <CatchUpSync>'s job, not the page's.
 */
export async function loadPageData(targetDate?: string) {
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
    nightsUsed: summary.nightsUsed,
    windowSpanDays: summary.windowSpanDays,
  };
}
