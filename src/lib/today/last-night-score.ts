// Last-night score for the Today screen, derived from an already-assembled
// dashboard payload. Pure — the caller reads stored rows only (no lazy HR
// fetch, no Google call) and says whether intra-night samples were cached.

import { addDays } from "@/lib/dates";
import { calculateSleepScoreBreakdown } from "@/lib/analytics/sleep";
import type { DashboardData } from "@/lib/sync/assemble";

/** Same bar as the sleep page's lazy fetch uses to call a night "populated". */
export const MIN_CACHED_NIGHT_SAMPLES = 10;

export type LastNightScore =
  | { kind: "not-synced" }
  | {
      kind: "scored";
      sleepDate: string;
      score: number;
      /** True when the cardiac component was unavailable (no cached samples). */
      partial: boolean;
      totalSleepMs: number;
    };

/**
 * Sessions are keyed by the date the night started, so last night is the one
 * keyed to yesterday; anything older means the sync hasn't brought it in yet.
 * With `partial` the score is recomputed with cardiac = null (the engine
 * redistributes the weight) rather than borrowing the daily-summary fallback.
 */
export function summarizeLastNight(data: DashboardData, today: string, partial: boolean): LastNightScore {
  if (!data.hasData || !data.lastNight) return { kind: "not-synced" };
  const night = data.lastNight;
  if (night.sleepDate !== addDays(today, -1)) return { kind: "not-synced" };

  let score = night.holisticScore;
  if (partial) {
    const timeInBedMs = new Date(night.endTime).getTime() - new Date(night.startTime).getTime();
    score = calculateSleepScoreBreakdown(
      night.totalSleepMs,
      timeInBedMs,
      night.continuity.continuityScore,
      night.restlessness.disruptionIndex,
      null,
    ).score;
  }

  return { kind: "scored", sleepDate: night.sleepDate, score, partial, totalSleepMs: night.totalSleepMs };
}
