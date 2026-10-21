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
