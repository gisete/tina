import type { AnalyticSession, SleepStageInterval, SleepStageType } from "./types";
import {
  calculateDeepSleepContinuity,
  calculateRemSleepContinuity,
  calculateLightSleepStability,
  type DeepSleepContinuity,
  type RemSleepContinuity,
  type LightSleepStability,
} from "./continuity";
import { calculateHolisticSleepScore } from "./score";

/** Output of {@link getLastNightDetail} — all primitives, ready for serialisation. */
export interface LastNightDetail {
  sleepDate: string;
  /** ISO 8601 — session start */
  startTime: string;
  /** ISO 8601 — session end */
  endTime: string;
  totalSleepMs: number;
  efficiencyScore: number;
  /**
   * Weighted composite (0-100): 45% volume sufficiency vs the 8h target,
   * 35% clinical efficiency (sleep / time in bed), 20% deep-sleep continuity.
   * When overnight heart data is available, the sync assembly recomputes this
   * with a 10% cardiac recovery component (40/30/20/10) — see assemble.ts.
   */
  holisticScore: number;
  /**
   * Aggregated percentage breakdown (0-100) for each stage.
   * Values sum to 100 (within rounding) and are derived from total duration,
   * so they feed directly into a proportional summary bar.
   */
  breakdown: {
    awakePercent: number;
    lightPercent: number;
    remPercent: number;
    deepPercent: number;
  };
  /**
   * Chronologically sorted stage intervals for an hour-by-hour timeline.
   * Sorted ascending by startTime.
   */
  timeline: SleepStageInterval[];
  /** Deep-sleep consolidation metrics derived from the timeline. */
  continuity: DeepSleepContinuity;
  /** REM-sleep consolidation metrics derived from the timeline. */
  remContinuity: RemSleepContinuity;
  /** Light-sleep proportion and awakening-transition metrics. */
  lightStability: LightSleepStability;
}

type RawStageInput = {
  stageType: SleepStageType;
  startTime: Date | string;
  endTime: Date | string;
  durationMs: number;
};

function toIso(t: Date | string): string {
  return t instanceof Date ? t.toISOString() : t;
}

/**
 * Isolates the most recent sleep session and returns:
 *  - `breakdown`: aggregated percentage per stage (0-100) for a summary bar.
 *  - `timeline`: chronologically sorted {@link SleepStageInterval} array for
 *    an hour-by-hour plot.
 *  - per-stage continuity/stability metrics.
 *
 * Accepts sessions whose stages carry full `startTime`/`endTime` data
 * (as returned by the DB query with `with: { stages: true }`).
 *
 * Returns `null` when the sessions array is empty or the latest session has
 * no stage rows.
 *
 * Pure function — no framework imports, no side effects.
 */
export function getLastNightDetail(
  sessions: Array<AnalyticSession & { stages?: RawStageInput[] }>
): LastNightDetail | null {
  if (sessions.length === 0) return null;

  // Pick the session with the latest sleepDate
  const latest = [...sessions].sort((a, b) =>
    b.sleepDate.localeCompare(a.sleepDate)
  )[0];

  const stages = latest.stages ?? [];
  if (stages.length === 0) return null;

  // Aggregate totals for breakdown percentages
  const totals = { deep: 0, light: 0, rem: 0, awake: 0 };
  let grandTotal = 0;
  for (const s of stages) {
    totals[s.stageType] += s.durationMs;
    grandTotal += s.durationMs;
  }

  const breakdown = grandTotal > 0
    ? {
        awakePercent: Math.round((totals.awake / grandTotal) * 100),
        lightPercent: Math.round((totals.light / grandTotal) * 100),
        remPercent: Math.round((totals.rem / grandTotal) * 100),
        deepPercent: Math.round((totals.deep / grandTotal) * 100),
      }
    : { awakePercent: 0, lightPercent: 0, remPercent: 0, deepPercent: 0 };

  // Sort stage intervals ascending by start time
  const timeline: SleepStageInterval[] = [...stages]
    .sort((a, b) => new Date(toIso(a.startTime)).getTime() - new Date(toIso(b.startTime)).getTime())
    .map((s) => ({
      stageType: s.stageType,
      startTime: toIso(s.startTime),
      endTime: toIso(s.endTime),
      durationMs: s.durationMs,
    }));

  const continuity = calculateDeepSleepContinuity(timeline);
  const timeInBedMs =
    new Date(toIso(latest.endTime)).getTime() - new Date(toIso(latest.startTime)).getTime();

  return {
    sleepDate: latest.sleepDate,
    startTime: toIso(latest.startTime),
    endTime: toIso(latest.endTime),
    totalSleepMs: latest.totalSleepMs,
    efficiencyScore: latest.efficiencyScore,
    holisticScore: calculateHolisticSleepScore(
      latest.totalSleepMs,
      timeInBedMs,
      continuity.continuityScore
    ),
    breakdown,
    timeline,
    continuity,
    remContinuity: calculateRemSleepContinuity(timeline),
    lightStability: calculateLightSleepStability(timeline, latest.totalSleepMs),
  };
}
