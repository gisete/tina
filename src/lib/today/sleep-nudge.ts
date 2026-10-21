import type { Condition } from "./types";

/**
 * Condition ids to highlight for last night's score: active conditions with a
 * threshold the score is strictly below. A null score highlights nothing.
 */
export function conditionsToHighlight(
  lastNightScore: number | null,
  conditions: Pick<Condition, "id" | "sleepScoreBelow" | "archived">[],
): number[] {
  if (lastNightScore === null) return [];
  return conditions
    .filter((c) => !c.archived && c.sleepScoreBelow !== null && lastNightScore < c.sleepScoreBelow)
    .map((c) => c.id);
}

export interface SleepNudge {
  score: number;
  /** Active conditions whose threshold last night's score fell below. */
  conditionIds: number[];
  message: string;
}

/**
 * The nudge to show on Today, or null when there is nothing to suggest
 * (no score yet, or no condition's threshold was crossed). Suggestion only —
 * callers must never auto-select or swap the workout.
 */
export function buildSleepNudge(
  lastNightScore: number | null,
  conditions: Pick<Condition, "id" | "sleepScoreBelow" | "archived">[],
): SleepNudge | null {
  const conditionIds = conditionsToHighlight(lastNightScore, conditions);
  if (lastNightScore === null || conditionIds.length === 0) return null;
  return { score: lastNightScore, conditionIds, message: `Last night scored ${lastNightScore}, consider this.` };
}
