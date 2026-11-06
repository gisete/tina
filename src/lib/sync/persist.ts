// Database persistence for synced health data. Owns the write transaction;
// callers hand in already-normalized records and never touch the schema.

import { db } from "@/db/client";
import {
  sleepSessions, sleepStages, heartRateSummaries, heartRateSamples, dailyActivitySummaries,
  exerciseSessions, dailyEnergy,
} from "@/db/schema";
import type {
  normalizeGoogleSleepSession,
  NormalizedHeartRecord,
  NormalizedHeartRateSample,
} from "@/lib/google/normalizers";
import type { NormalizedDailyEnergy, NormalizedExerciseSession } from "@/lib/google/exercise-normalizers";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export type NormalizedSleepSession = NonNullable<ReturnType<typeof normalizeGoogleSleepSession>>;

/**
 * Writes a sync batch in a single transaction:
 *  - sleep: check-then-insert per session to avoid re-inserting duplicate stage rows
 *  - heart: bulk upsert on the (userId, date) unique index, COALESCE-preserving
 *    existing non-null readings when the new fetch returned null for a metric
 */
export async function persistHealthRecords(
  userId: string,
  normalizedSleep: NormalizedSleepSession[],
  heartRecords: NormalizedHeartRecord[]
): Promise<void> {
  await db.transaction(async (tx) => {

    let inserted = 0;
    let refreshed = 0;
    for (const { session: sleepSession, stages } of normalizedSleep) {
      // Upsert on (userId, startTime) — the physical start of the session is
      // its identity. On conflict we refresh mutable fields and replace stages.
      const [upserted] = await tx
        .insert(sleepSessions)
        .values(sleepSession)
        .onConflictDoUpdate({
          target: [sleepSessions.userId, sleepSessions.startTime],
          set: {
            // sleepDate is included so a re-sync after the nightOf() fix
            // corrects any rows that were keyed to the wrong UTC calendar date.
            sleepDate: sql`EXCLUDED.sleep_date`,
            endTime: sql`EXCLUDED.end_time`,
            totalSleepMs: sql`EXCLUDED.total_sleep_ms`,
            efficiencyScore: sql`EXCLUDED.efficiency_score`,
            timelineRaw: sql`EXCLUDED.timeline_raw`,
            // COALESCE: a stored offset is never overwritten by a null from a payload lacking it.
            startUtcOffsetSeconds: sql`COALESCE(EXCLUDED.start_utc_offset_seconds, ${sleepSessions.startUtcOffsetSeconds})`,
            endUtcOffsetSeconds: sql`COALESCE(EXCLUDED.end_utc_offset_seconds, ${sleepSessions.endUtcOffsetSeconds})`,
            source: sql`EXCLUDED.source`,
          },
        })
        .returning({ id: sleepSessions.id });

      const isRefresh = upserted.id !== sleepSession.id;

      if (process.env.SYNC_DEBUG === "1") {
        console.log(
          `[sync:debug] persist    sleepDate=${sleepSession.sleepDate}  startTime=${sleepSession.startTime.toISOString()}  → ${isRefresh ? "refreshed" : "inserted"}`
        );
      }

      if (isRefresh) {
        // Replace stage rows: delete the old set and insert the fresh one under
        // the existing session ID (not the freshly generated one in the stages).
        await tx.delete(sleepStages).where(eq(sleepStages.sessionId, upserted.id));
        if (stages.length > 0) {
          await tx.insert(sleepStages).values(
            stages.map((s) => ({ ...s, id: crypto.randomUUID(), sessionId: upserted.id }))
          );
        }
        refreshed++;
      } else {
        if (stages.length > 0) {
          await tx.insert(sleepStages).values(stages);
        }
        inserted++;
      }
    }

    console.log(`[sync] Sessions: ${inserted} inserted, ${refreshed} refreshed`);

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
            restingHeartRate: sql`COALESCE(EXCLUDED.resting_heart_rate, ${heartRateSummaries.restingHeartRate})`,
            hrvRmssd: sql`COALESCE(EXCLUDED.hrv_rmssd, ${heartRateSummaries.hrvRmssd})`,
            updatedAt: sql`NOW()`,
          },
        });
      console.log(`[sync] Upserted ${heartRecords.length} heart records`);
    }
  });
}

export interface ActivitySummaryRow {
  activityDate: string; // "YYYY-MM-DD"
  lightMinutes: number;
  moderateMinutes: number;
  vigorousMinutes: number;
  peakMinutes: number;
}

/**
 * Upserts one row per civil day into daily_activity_summaries.
 * On conflict (re-sync of a recent day), all zone minute columns are replaced —
 * the new fetch is authoritative, unlike the COALESCE-preserving pattern for
 * heart summaries (zone minutes can decrease if the API reconciles corrections).
 */
export async function persistActivitySummaries(
  userId: string,
  summaries: ActivitySummaryRow[],
): Promise<void> {
  if (summaries.length === 0) return;
  await db
    .insert(dailyActivitySummaries)
    .values(summaries.map((s) => ({ userId, ...s })))
    .onConflictDoUpdate({
      target: [dailyActivitySummaries.userId, dailyActivitySummaries.activityDate],
      set: {
        lightMinutes:    sql`EXCLUDED.light_minutes`,
        moderateMinutes: sql`EXCLUDED.moderate_minutes`,
        vigorousMinutes: sql`EXCLUDED.vigorous_minutes`,
        peakMinutes:     sql`EXCLUDED.peak_minutes`,
        updatedAt:       sql`NOW()`,
      },
    });
  console.log(`[sync] Upserted ${summaries.length} activity summaries`);
}

export interface DailyStepsRow {
  activityDate: string; // "YYYY-MM-DD"
  steps: number;
}

/**
 * Upserts daily step totals into daily_activity_summaries. Today's total is
 * partial and grows through the day, so the incoming value always overwrites
 * (deliberately NOT COALESCE-preserving). Only the steps column is touched on
 * conflict, so zone minutes written by persistActivitySummaries survive;
 * rows created here start with the zone-minute column defaults (0).
 */
export async function persistDailySteps(
  userId: string,
  rows: DailyStepsRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(dailyActivitySummaries)
    .values(rows.map((r) => ({ userId, activityDate: r.activityDate, steps: r.steps })))
    .onConflictDoUpdate({
      target: [dailyActivitySummaries.userId, dailyActivitySummaries.activityDate],
      set: {
        steps:     sql`EXCLUDED.steps`,
        updatedAt: sql`NOW()`,
      },
    });
  console.log(`[sync] Upserted ${rows.length} daily step totals`);
}

/**
 * Bulk-upserts intra-day heart rate samples on the (userId, timestamp) unique
 * index. Re-synced windows overwrite bpm in place, so corrected readings from
 * Google replace stale ones.
 */
export async function persistHeartRateSamples(samples: NormalizedHeartRateSample[]): Promise<void> {
  if (samples.length === 0) return;

  await db
    .insert(heartRateSamples)
    .values(samples)
    .onConflictDoUpdate({
      target: [heartRateSamples.userId, heartRateSamples.timestamp],
      set: { bpm: sql`EXCLUDED.bpm` },
    });
  console.log(`[sync] Upserted ${samples.length} heart rate samples`);
}

/**
 * Delete-and-replace of exercise sessions for the fetched civil-date window
 * [from, to], in one transaction, so deletions and edits made in Google carry
 * over. The insert still upserts on (user, Google data point ID): a session
 * whose local date moved outside the window must not duplicate.
 * Only call with a fetch that fully succeeded: an empty list means "no workouts".
 * `deleteMissing: false` upserts only, for a batch where some points were
 * unreadable (their stored rows must not be deleted).
 */
export async function replaceExerciseSessions(
  userId: string,
  from: string,
  to: string,
  sessions: NormalizedExerciseSession[],
  deleteMissing: boolean = true,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (deleteMissing) {
      await tx
        .delete(exerciseSessions)
        .where(and(
          eq(exerciseSessions.userId, userId),
          gte(exerciseSessions.exerciseDate, from),
          lte(exerciseSessions.exerciseDate, to),
        ));
    }
    if (sessions.length === 0) return;
    await tx
      .insert(exerciseSessions)
      .values(sessions.map((s) => ({ userId, ...s })))
      .onConflictDoUpdate({
        target: [exerciseSessions.userId, exerciseSessions.googleDataPointId],
        set: {
          exerciseDate: sql`EXCLUDED.exercise_date`,
          exerciseType: sql`EXCLUDED.exercise_type`,
          displayName: sql`EXCLUDED.display_name`,
          startTime: sql`EXCLUDED.start_time`,
          endTime: sql`EXCLUDED.end_time`,
          startUtcOffsetSeconds: sql`EXCLUDED.start_utc_offset_seconds`,
          endUtcOffsetSeconds: sql`EXCLUDED.end_utc_offset_seconds`,
          activeDurationSeconds: sql`EXCLUDED.active_duration_seconds`,
          caloriesKcal: sql`EXCLUDED.calories_kcal`,
          distanceMeters: sql`EXCLUDED.distance_meters`,
          steps: sql`EXCLUDED.steps`,
          avgHeartRateBpm: sql`EXCLUDED.avg_heart_rate_bpm`,
          avgPaceSecondsPerMeter: sql`EXCLUDED.avg_pace_seconds_per_meter`,
          activeZoneMinutes: sql`EXCLUDED.active_zone_minutes`,
          lightZoneSeconds: sql`EXCLUDED.light_zone_seconds`,
          moderateZoneSeconds: sql`EXCLUDED.moderate_zone_seconds`,
          vigorousZoneSeconds: sql`EXCLUDED.vigorous_zone_seconds`,
          peakZoneSeconds: sql`EXCLUDED.peak_zone_seconds`,
          recordingMethod: sql`EXCLUDED.recording_method`,
          updatedAt: sql`NOW()`,
        },
      });
  });
  console.log(`[sync] Replaced exercise sessions ${from}..${to}: ${sessions.length} stored`);
}

/**
 * Upserts daily total/active calories. Today's totals grow through the day, so
 * a present incoming value overwrites; a null incoming column keeps the stored
 * value (COALESCE) so a rollup that omitted a day never erases a good reading.
 */
export async function persistDailyEnergy(userId: string, rows: NormalizedDailyEnergy[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(dailyEnergy)
    .values(rows.map((r) => ({ userId, ...r })))
    .onConflictDoUpdate({
      target: [dailyEnergy.userId, dailyEnergy.energyDate],
      set: {
        totalCaloriesKcal: sql`COALESCE(EXCLUDED.total_calories_kcal, ${dailyEnergy.totalCaloriesKcal})`,
        activeCaloriesKcal: sql`COALESCE(EXCLUDED.active_calories_kcal, ${dailyEnergy.activeCaloriesKcal})`,
        updatedAt: sql`NOW()`,
      },
    });
  console.log(`[sync] Upserted ${rows.length} daily energy rows`);
}
