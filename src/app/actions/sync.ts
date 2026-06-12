"use server";

import { auth } from "@/auth";
import { db } from "@/db/client";
import { sleepSessions, heartRateSummaries, heartRateSamples } from "@/db/schema";
import {
  fetchGoogleSleepData,
  fetchGoogleHeartData,
  fetchGoogleHeartRateSamples,
} from "@/lib/google/client";
import {
  normalizeGoogleSleepSession,
  normalizeHeartData,
  normalizeHeartRateSamples,
} from "@/lib/google/normalizers";
import { persistHealthRecords, persistHeartRateSamples } from "@/lib/sync/persist";
import { assembleDashboardData } from "@/lib/sync/assemble";
import { eq, and, asc, desc, gte, lt, lte } from "drizzle-orm";

/**
 * Orchestrates one dashboard data cycle: fetch from Google Health, normalize,
 * persist, then assemble analytics from historical rows. The heavy lifting
 * lives in `@/lib/sync` (persistence + pure assembly) and `@/lib/analytics`.
 *
 * @param targetDate Optional "YYYY-MM-DD" anchor. When provided, the sync
 * window ends on that date and all analytics queries exclude later records,
 * so the dashboard reflects the state as of that day. Defaults to now.
 */
export async function syncAndFetchSleepAnalytics(daysToSync: number = 30, targetDate?: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized: You must be logged in to sync data.");
  }
  const userId = session.user.id;

  const endDate = targetDate ? new Date(`${targetDate}T23:59:59`) : new Date();
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - daysToSync);
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  try {
    // Fetch both data streams in parallel. Heart data is treated as optional —
    // if the API returns an error (e.g. data type not yet available on the
    // connected device) we log and continue rather than aborting the sleep sync.
    const [sleepResult, heartResult] = await Promise.allSettled([
      fetchGoogleSleepData(userId, startISO, endISO),
      fetchGoogleHeartData(userId, startISO, endISO),
    ]);

    if (sleepResult.status === "rejected") {
      throw sleepResult.reason;
    }
    if (heartResult.status === "rejected") {
      console.warn("[sync] Heart data fetch failed (continuing):", heartResult.reason?.message ?? heartResult.reason);
    }
    const rawHeartData = heartResult.status === "fulfilled" ? heartResult.value : null;

    const normalizedSleep = sleepResult.value
      .map((raw) => normalizeGoogleSleepSession(userId, raw))
      .filter((n): n is NonNullable<typeof n> => n !== null);

    const heartRecords = rawHeartData
      ? normalizeHeartData(userId, rawHeartData.heartRatePoints, rawHeartData.hrvPoints)
      : [];

    console.log(`[sync] Normalized: ${normalizedSleep.length} sleep sessions, ${heartRecords.length} heart records`);

    await persistHealthRecords(userId, normalizedSleep, heartRecords);

    // -----------------------------------------------------------------------
    // Query historical data for analytics (parallel reads)
    // -----------------------------------------------------------------------
    const [historicalSessions, historicalHeartRows] = await Promise.all([
      // Sessions are stored under the date the night STARTED, but a selected
      // day should show the night the user woke up from that morning — hence
      // strictly-before. (Selecting today = the session that started yesterday
      // evening; each step back moves exactly one night.)
      db.query.sleepSessions.findMany({
        where: targetDate
          ? and(eq(sleepSessions.userId, userId), lt(sleepSessions.sleepDate, targetDate))
          : eq(sleepSessions.userId, userId),
        orderBy: [desc(sleepSessions.sleepDate)],
        limit: 45,
        with: { stages: true },
      }),
      // Heart summaries are calendar-day readings, so the selected day itself
      // is included.
      db.query.heartRateSummaries.findMany({
        where: targetDate
          ? and(eq(heartRateSummaries.userId, userId), lte(heartRateSummaries.date, targetDate))
          : eq(heartRateSummaries.userId, userId),
        orderBy: [desc(heartRateSummaries.date)],
        limit: 45,
      }),
    ]);

    console.log(`[sync] Historical: ${historicalSessions.length} sleep sessions, ${historicalHeartRows.length} heart rows`);

    // -----------------------------------------------------------------------
    // Intra-night heart rate samples for the displayed night. Served from the
    // heart_rate_samples cache; fetched from Google once per night when the
    // cache is sparse. Treated as optional — chart absence shouldn't fail the
    // page.
    // -----------------------------------------------------------------------
    let nightSamples: Array<{ timestamp: Date; bpm: number }> = [];
    const displayedSession = historicalSessions[0];
    if (displayedSession) {
      const readSamples = () =>
        db.query.heartRateSamples.findMany({
          where: and(
            eq(heartRateSamples.userId, userId),
            gte(heartRateSamples.timestamp, displayedSession.startTime),
            lte(heartRateSamples.timestamp, displayedSession.endTime),
          ),
          orderBy: [asc(heartRateSamples.timestamp)],
        });

      nightSamples = await readSamples();
      if (nightSamples.length < 10) {
        try {
          const raw = await fetchGoogleHeartRateSamples(
            userId,
            displayedSession.startTime.toISOString(),
            displayedSession.endTime.toISOString()
          );
          const normalized = normalizeHeartRateSamples(userId, raw);
          if (normalized.length > 0) {
            await persistHeartRateSamples(normalized);
            nightSamples = await readSamples();
          }
        } catch (err) {
          console.warn("[sync] HR samples fetch failed (continuing):", err instanceof Error ? err.message : err);
        }
      }
    }

    return assembleDashboardData(
      historicalSessions,
      historicalHeartRows.map((r) => ({
        date: r.date,
        restingHeartRate: r.restingHeartRate,
        hrvRmssd: r.hrvRmssd,
      })),
      nightSamples
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync] Orchestration error:", message, error);
    throw new Error(`Sync failed: ${message}`);
  }
}
