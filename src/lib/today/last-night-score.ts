// Last-night score for the Today screen, derived from an already-assembled
// dashboard payload. Pure — the caller reads stored rows only (no lazy HR
// fetch, no Google call) and says whether intra-night samples were cached.

import { addDays } from "@/lib/dates";
import { calculateSleepScoreBreakdown, liveSleepEfficiency } from "@/lib/analytics/sleep";
import type { NightHeartStatus } from "@/lib/analytics/sleep";
import type { StageMinutes } from "@/lib/charts/stage-mix";
import type { DashboardData } from "@/lib/sync/assemble";

/** Same bar as the sleep page's lazy fetch uses to call a night "populated". */
export const MIN_CACHED_NIGHT_SAMPLES = 10;

/** Stored-data detail for the Today card; same selectors the Sleep page reads. */
export interface LastNightDetail {
  /** Live 0-1 fraction (asleep / time in bed, the score engine's definition); null with no time in bed. */
  efficiency: number | null;
  stageMins: StageMinutes;
  /** Null when no night heart summary exists for the displayed night. */
  heart: { restingHr: number | null; hrv: number | null; baselineRhr: number | null; status: NightHeartStatus } | null;
}

export type LastNightScore =
  | { kind: "not-synced" }
  | {
      kind: "scored";
      sleepDate: string;
      score: number;
      /** True when the cardiac component was unavailable (no cached samples). */
      partial: boolean;
      totalSleepMs: number;
      detail: LastNightDetail;
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

  const timeInBedMs = new Date(night.endTime).getTime() - new Date(night.startTime).getTime();
  let score = night.holisticScore;
  if (partial) {
    score = calculateSleepScoreBreakdown(
      night.totalSleepMs,
      timeInBedMs,
      night.continuity.continuityScore,
      night.restlessness.disruptionIndex,
      null,
    ).score;
  }

  const mins = (stage: "deep" | "light" | "rem" | "awake"): number =>
    Math.round((night.timeline ?? []).filter((i) => i.stageType === stage).reduce((a, i) => a + i.durationMs, 0) / 60000);
  const h = data.nightHeart;

  return {
    kind: "scored",
    sleepDate: night.sleepDate,
    score,
    partial,
    totalSleepMs: night.totalSleepMs,
    detail: {
      efficiency: liveSleepEfficiency(night.totalSleepMs, timeInBedMs),
      stageMins: { deepMins: mins("deep"), lightMins: mins("light"), remMins: mins("rem"), awakeMins: mins("awake") },
      heart: h ? { restingHr: h.restingHr, hrv: h.hrv, baselineRhr: h.baselineRhr, status: h.status } : null,
    },
  };
}
