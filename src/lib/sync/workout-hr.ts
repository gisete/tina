// Per-workout heart-rate samples, stored in the existing heart_rate_samples
// table (workouts join to samples by time range). Orchestration only: the
// overlap rule is pure (workout-samples.ts).
//
// Sequential by design: one Google call per workout, never parallel, with a
// short pause between calls. Throws on the first failure so a range sync is
// never reported complete with workouts missing their samples.

import { db } from "@/db/client";
import { sleepSessions } from "@/db/schema";
import { fetchGoogleHeartRateSamples } from "@/lib/google/client";
import type { NormalizedExerciseSession } from "@/lib/google/exercise-normalizers";
import { normalizeHeartRateSamples } from "@/lib/google/normalizers";
import { persistHeartRateSamples } from "@/lib/sync/persist";
import { excludeSamplesInWindows, WORKOUT_HR_PAUSE_MS, type TimeWindow } from "@/lib/sync/workout-samples";
import { and, eq, gte, lte } from "drizzle-orm";

export interface WorkoutHrCounts {
  /** Google heart-rate calls made (one per workout). */
  calls: number;
  /** Samples handed to the upsert, after the sleep-window exclusion. */
  samplesStored: number;
  /** Samples dropped because they fall inside a stored sleep session. */
  samplesSkipped: number;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Stored sleep session windows (any session type) that intersect [from, to]. */
async function readSleepWindows(userId: string, from: Date, to: Date): Promise<TimeWindow[]> {
  const rows = await db
    .select({ start: sleepSessions.startTime, end: sleepSessions.endTime })
    .from(sleepSessions)
    .where(and(
      eq(sleepSessions.userId, userId),
      lte(sleepSessions.startTime, to),
      gte(sleepSessions.endTime, from),
    ));
  return rows;
}

export async function syncWorkoutHeartRate(
  userId: string,
  sessions: NormalizedExerciseSession[],
): Promise<WorkoutHrCounts> {
  const counts: WorkoutHrCounts = { calls: 0, samplesStored: 0, samplesSkipped: 0 };

  for (const s of sessions) {
    if (counts.calls > 0) await pause(WORKOUT_HR_PAUSE_MS);

    const raw = await fetchGoogleHeartRateSamples(userId, s.startTime.toISOString(), s.endTime.toISOString());
    counts.calls++;

    const samples = normalizeHeartRateSamples(userId, raw);
    // Read after the sleep sessions of this range were persisted.
    const windows = await readSleepWindows(userId, s.startTime, s.endTime);
    const kept = excludeSamplesInWindows(samples, windows);

    await persistHeartRateSamples(kept);
    counts.samplesStored += kept.length;
    counts.samplesSkipped += samples.length - kept.length;
  }

  return counts;
}
