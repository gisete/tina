// Database persistence for synced health data. Owns the write transaction;
// callers hand in already-normalized records and never touch the schema.

import { db } from "@/db/client";
import { sleepSessions, sleepStages, heartRateSummaries, heartRateSamples } from "@/db/schema";
import type {
  normalizeGoogleSleepSession,
  NormalizedHeartRecord,
  NormalizedHeartRateSample,
} from "@/lib/google/normalizers";
import { eq, and, sql } from "drizzle-orm";

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
