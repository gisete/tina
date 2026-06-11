"use server";

import { auth } from "@/auth";
import { db } from "@/db/client";
import { sleepSessions, sleepStages, heartRateSummaries } from "@/db/schema";
import { fetchGoogleSleepData, fetchGoogleHeartData } from "@/lib/google/client";
import { normalizeGoogleSleepSession, normalizeHeartData } from "@/lib/google/normalizers";
import {
  calculateSleepArchitecture,
  calculateCircadianVariance,
  calculateSleepDebt,
  getLastNightDetail,
} from "@/lib/analytics/sleep";
import { calculateHeartAnalytics } from "@/lib/analytics/heart";
import { eq, and, desc, sql } from "drizzle-orm";

export async function syncAndFetchSleepAnalytics(daysToSync: number = 14) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized: You must be logged in to sync data.");
  }
  const userId = session.user.id;

  const endDate = new Date();
  const startDate = new Date();
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
    const rawSessions = sleepResult.value;

    if (heartResult.status === "rejected") {
      console.warn("[sync] Heart data fetch failed (continuing):", heartResult.reason?.message ?? heartResult.reason);
    }
    const rawHeartData = heartResult.status === "fulfilled" ? heartResult.value : null;

    // Normalize both streams before touching the database
    const normalizedSleep = rawSessions
      .map((raw) => normalizeGoogleSleepSession(userId, raw))
      .filter((n): n is NonNullable<typeof n> => n !== null);

    const heartRecords = rawHeartData
      ? normalizeHeartData(userId, rawHeartData.heartRatePoints, rawHeartData.hrvPoints)
      : [];

    console.log(`[sync] Normalized: ${normalizedSleep.length} sleep sessions, ${heartRecords.length} heart records`);

    // -----------------------------------------------------------------------
    // Single transaction: all sleep inserts + bulk heart upsert
    // -----------------------------------------------------------------------
    await db.transaction(async (tx) => {

      // --- Sleep (check-then-insert to avoid re-inserting duplicate stage rows) ---
      for (const { session: sleepSession, stages } of normalizedSleep) {
        const existing = await tx
          .select({ id: sleepSessions.id })
          .from(sleepSessions)
          .where(and(
            eq(sleepSessions.userId, userId),
            eq(sleepSessions.sleepDate, sleepSession.sleepDate),
          ))
          .limit(1);

        if (existing.length === 0) {
          await tx.insert(sleepSessions).values(sleepSession);
          if (stages.length > 0) {
            await tx.insert(sleepStages).values(stages);
          }
          console.log(`[sync] Inserted sleep session for ${sleepSession.sleepDate}`);
        } else {
          console.log(`[sync] Skipped duplicate sleep for ${sleepSession.sleepDate}`);
        }
      }

      // --- Heart (bulk upsert on the (userId, date) unique index) ---
      if (heartRecords.length > 0) {
        await tx
          .insert(heartRateSummaries)
          .values(heartRecords.map((r) => ({
            userId: r.userId,
            date: r.date,
            restingHeartRate: r.restingHeartRate,
            hrvRmssd: r.hrvRmssd,
          })))
          .onConflictDoUpdate({
            target: [heartRateSummaries.userId, heartRateSummaries.date],
            set: {
              // Use EXCLUDED to pick up the freshest values from the incoming row.
              // COALESCE preserves an existing non-null reading if the new fetch
              // returned null for that metric on the same day.
              restingHeartRate: sql`COALESCE(EXCLUDED.resting_heart_rate, ${heartRateSummaries.restingHeartRate})`,
              hrvRmssd: sql`COALESCE(EXCLUDED.hrv_rmssd, ${heartRateSummaries.hrvRmssd})`,
              updatedAt: sql`NOW()`,
            },
          });
        console.log(`[sync] Upserted ${heartRecords.length} heart records`);
      }
    });

    // -----------------------------------------------------------------------
    // Query historical data for analytics (parallel reads)
    // -----------------------------------------------------------------------
    const [historicalSessions, historicalHeartRows] = await Promise.all([
      db.query.sleepSessions.findMany({
        where: eq(sleepSessions.userId, userId),
        orderBy: [desc(sleepSessions.sleepDate)],
        limit: 30,
        with: { stages: true },
      }),
      db.query.heartRateSummaries.findMany({
        where: eq(heartRateSummaries.userId, userId),
        orderBy: [desc(heartRateSummaries.date)],
        limit: 30,
      }),
    ]);

    console.log(`[sync] Historical: ${historicalSessions.length} sleep sessions, ${historicalHeartRows.length} heart rows`);

    if (historicalSessions.length === 0) {
      return { hasData: false as const, message: "No sleep records processed yet." };
    }

    // -----------------------------------------------------------------------
    // Sleep analytics
    // -----------------------------------------------------------------------
    const analyticSessions = historicalSessions.map((s) => ({
      sleepDate: s.sleepDate,
      startTime: s.startTime,
      endTime: s.endTime,
      totalSleepMs: s.totalSleepMs,
      efficiencyScore: s.efficiencyScore,
      // Preserve startTime/endTime per stage so getLastNightDetail can build
      // the chronological timeline without a second DB round-trip.
      stages: s.stages.map((st) => ({
        stageType: st.stageType,
        startTime: st.startTime,
        endTime: st.endTime,
        durationMs: st.durationMs,
      })),
    }));

    const latestSessionWithStages = analyticSessions[0];
    const architecture = calculateSleepArchitecture(latestSessionWithStages.stages ?? []);
    const variance = calculateCircadianVariance(analyticSessions);
    const debt = calculateSleepDebt(analyticSessions, 8);
    const lastNight = getLastNightDetail(analyticSessions);

    const chartTimeline = [...analyticSessions]
      .sort((a, b) => a.sleepDate.localeCompare(b.sleepDate))
      .map((s) => {
        const debtItem = debt.timeline.find((t) => t.date === s.sleepDate);
        return {
          date: s.sleepDate,
          efficiency: Math.round(s.efficiencyScore * 100),
          runningDebtHours: debtItem?.runningDebtHours ?? 0,
        };
      });

    // -----------------------------------------------------------------------
    // Heart analytics
    // -----------------------------------------------------------------------
    const heart = calculateHeartAnalytics(
      historicalHeartRows.map((r) => ({
        date: r.date,
        restingHeartRate: r.restingHeartRate,
        hrvRmssd: r.hrvRmssd,
      }))
    );

    return {
      hasData: true as const,
      latestSummary: latestSessionWithStages,
      chartTimeline,
      analytics: { architecture, variance, debt },
      lastNight,
      heart,
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync] Orchestration error:", message, error);
    throw new Error(`Sync failed: ${message}`);
  }
}
