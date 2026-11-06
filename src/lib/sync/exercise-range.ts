// Exercise slice of a range sync: sessions, the two calorie rollups and
// per-workout HR. Shared by syncDateRange (the full path) and the exercise-only
// recovery mode, so both use the exact same normalize/persist code and guards:
// the page-cap throw (client.ts), no deletes when any point is unreadable, and
// the skip of workout samples inside stored sleep windows (workout-hr.ts).

import { fetchGoogleDailyEnergy, fetchGoogleExerciseSessions } from "@/lib/google/client";
import { GoogleAuthError } from "@/lib/google/errors";
import { normalizeDailyEnergy, normalizeExercisePoints } from "@/lib/google/exercise-normalizers";
import { addDays } from "@/lib/dates";
import { persistDailyEnergy, replaceExerciseSessions } from "@/lib/sync/persist";
import { syncWorkoutHeartRate } from "@/lib/sync/workout-hr";

/** Rows handed to each upsert by the exercise slice of one range. */
export interface ExerciseRowCounts {
  /** exercise_sessions stored for the range (after delete-and-replace). */
  exerciseSessions: number;
  /** daily_energy rows written. */
  energyDays: number;
  /** Google heart-rate calls made for workout windows (one per workout). */
  workoutHrCalls: number;
  /** Workout heart-rate samples written, after the sleep-window exclusion. */
  workoutHrSamples: number;
}

export interface ExerciseFetch {
  exercise: Awaited<ReturnType<typeof fetchGoogleExerciseSessions>>;
  energy: Awaited<ReturnType<typeof fetchGoogleDailyEnergy>>;
}

/**
 * Normalizes and persists a completed exercise fetch for the inclusive civil
 * range [from, to]. Call only after EVERY fetch succeeded (an empty list means
 * "no workouts"), and, on the full path, after sleep was persisted so the
 * sleep windows are current.
 */
export async function persistExerciseSlice(
  userId: string,
  from: string,
  to: string,
  fetched: ExerciseFetch,
): Promise<ExerciseRowCounts> {
  const batch = normalizeExercisePoints(fetched.exercise);
  if (batch.skipped > 0) {
    console.warn(`[sync] Skipped ${batch.skipped} exercise point(s) missing required fields`);
  }
  const energyRows = normalizeDailyEnergy(fetched.energy.total, fetched.energy.active);

  // Unreadable points: upsert only, so their stored rows are not deleted.
  await replaceExerciseSessions(userId, from, to, batch.sessions, batch.skipped === 0);
  await persistDailyEnergy(userId, energyRows);
  const hr = await syncWorkoutHeartRate(userId, batch.sessions);

  return {
    exerciseSessions: batch.sessions.length,
    energyDays: energyRows.length,
    workoutHrCalls: hr.calls,
    workoutHrSamples: hr.samplesStored,
  };
}

/**
 * Exercise-only range: fetches just the exercise slice and persists it. Never
 * touches sleep, heart summaries, zones or steps. A rejected fetch throws
 * (auth failures take precedence) before anything is written.
 */
export async function syncExerciseRange(userId: string, from: string, to: string): Promise<ExerciseRowCounts> {
  const results = await Promise.allSettled([
    fetchGoogleExerciseSessions(userId, from, addDays(to, 1)),
    fetchGoogleDailyEnergy(userId, from, addDays(to, 1)),
  ]);
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    const auth = failures.find((f) => f.reason instanceof GoogleAuthError);
    throw (auth ?? failures[0]).reason;
  }
  const [exercise, energy] = results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as [
    ExerciseFetch["exercise"],
    ExerciseFetch["energy"],
  ];
  return persistExerciseSlice(userId, from, to, { exercise, energy });
}
