// The `exercise` and `energy` blocks of a day payload — types and a pure builder over the Task 16
// engine (src/lib/analytics/exercise.ts). Primitives in, plain JSON out; no React/Next/DB imports.

import {
  buildWorkouts,
  classifyDailyEnergy,
  isExerciseSynced,
  rollupWorkouts,
  type DailyWorkoutRollup,
  type EnergyFigure,
  type Workout,
  type WorkoutInput,
} from "@/lib/analytics/exercise";
import { measured, unavailable, type MetricValue } from "./metric";

export interface ExerciseSummary extends DailyWorkoutRollup {
  /** The day's total calories (all activity, Google's figure) used for shareOfTotalCalories; null when unavailable. */
  totalCaloriesKcal: number | null;
}

/** `sessions` is an array only when the day was synced; an empty array then means "synced, no workouts". */
export type ExerciseBlock =
  | { status: "synced"; partialDay: boolean; sessions: Workout[]; summary: ExerciseSummary }
  | { status: "unavailable"; reason: "not_synced" };

export interface EnergyBlock {
  totalCalories: MetricValue;
  activeCalories: MetricValue;
}

export interface ExerciseDayInput {
  /** Sessions whose local start date is this day (any order). */
  sessions: WorkoutInput[];
  /** Earliest stored daily_energy or session date (when the exercise slice was first fetched); null if none. */
  coverageStart: string | null;
  /** This day's daily_energy row values; null when no row is stored. */
  totalCaloriesKcal: number | null;
  activeCaloriesKcal: number | null;
  /** A heart_rate_summaries row or any heart_rate_samples exist for this day. */
  hasWearEvidence: boolean;
}

function energyMetric(f: EnergyFigure): MetricValue {
  return f.status === "measured"
    ? measured(f.kcal, "kcal", f.partialDay ? ["partial_day"] : undefined)
    : unavailable(f.reason);
}

export function buildExerciseBlocks(
  date: string,
  today: string,
  syncedThrough: string | null,
  input: ExerciseDayInput,
): { exercise: ExerciseBlock; energy: EnergyBlock } {
  const synced = isExerciseSynced({ date, syncedThrough, coverageStart: input.coverageStart });
  const energy = classifyDailyEnergy({
    date,
    today,
    synced,
    totalCaloriesKcal: input.totalCaloriesKcal,
    activeCaloriesKcal: input.activeCaloriesKcal,
    hasWearEvidence: input.hasWearEvidence,
  });
  const energyBlock: EnergyBlock = { totalCalories: energyMetric(energy.total), activeCalories: energyMetric(energy.active) };
  if (!synced) return { exercise: { status: "unavailable", reason: "not_synced" }, energy: energyBlock };

  const sessions = buildWorkouts(input.sessions);
  // The share uses the total only when it is a real measurement (a resting-only fill is not).
  const total = energy.total.status === "measured" ? energy.total.kcal : null;
  return {
    exercise: {
      status: "synced",
      partialDay: date === today,
      sessions,
      summary: { ...rollupWorkouts(sessions, total), totalCaloriesKcal: total },
    },
    energy: energyBlock,
  };
}
