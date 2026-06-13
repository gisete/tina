// Intra-night cardiac strain engine.
//
// Uses 1-minute-binned HR samples filtered to non-awake stage intervals to
// measure how much of actual sleep time the heart rate spent at or below the
// user's daytime resting baseline. Time below baseline = genuine cardiac
// recovery; time at or above = residual strain. Pure function: no framework
// imports, no side effects.

import type { SleepStageInterval } from "./types";
import { downsampleToMinuteBins } from "./utils";

// ---------------------------------------------------------------------------
// Scoring constants (documented rationale below each)
// ---------------------------------------------------------------------------

/**
 * Minimum number of asleep-minutes of HR data required before returning a
 * result. Fewer samples produce unreliable fractions.
 */
const MIN_ASLEEP_MINUTES = 30;

/**
 * Fraction of asleep minutes at or below the daily-RHR baseline that earns a
 * full strainRecoveryScore of 100. Research suggests HR during healthy sleep
 * dips 10-30% below waking RHR, so 60% of sleep time at or below the resting
 * baseline is a conservative "excellent recovery" threshold. Below that the
 * score scales linearly to 0.
 */
const FULL_RECOVERY_BELOW_PCT = 60;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CardiacStrain {
  /** Mean bpm across minutes falling inside non-awake stage intervals. */
  avgAsleepBpm: number;
  /**
   * (avgAsleepBpm − baselineRhr) / baselineRhr.
   * Negative values mean the heart was running below daytime RHR (good);
   * positive means residual elevation (strain).
   */
  deviationFromBaseline: number;
  /**
   * Percentage (0-100) of asleep minutes where bpm ≤ baselineRhr.
   * The primary driver of strainRecoveryScore.
   */
  timeBelowBaselinePct: number;
  /** Number of 1-min bins that fell inside a non-awake stage interval. */
  asleepMinutes: number;
  /**
   * 0-100 composite recovery score.
   * timeBelowBaselinePct ≥ FULL_RECOVERY_BELOW_PCT → 100.
   * Scales linearly down to 0 as the below-baseline fraction shrinks.
   */
  strainRecoveryScore: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Derives intra-night cardiac strain metrics and a 0-100 recovery score.
 *
 * Returns null when:
 *  - `baselineRhr` is null (no reference to compare against), or
 *  - fewer than MIN_ASLEEP_MINUTES of HR data fall inside sleep stages.
 *
 * @param samples     Raw HR readings (any sampling rate — downsampled internally).
 * @param timeline    Sleep stage intervals for the same session.
 * @param baselineRhr Daily resting HR (7-day rolling avg from the heart engine).
 */
export function calculateCardiacStrain(
  samples: { timestamp: number; bpm: number }[],
  timeline: SleepStageInterval[],
  baselineRhr: number | null
): CardiacStrain | null {
  if (baselineRhr === null || samples.length < 2) return null;

  const binned = downsampleToMinuteBins(samples);
  if (binned.length < 2) return null;

  // Only score minutes that fall inside a non-awake stage interval.
  // Awake blocks reflect waking-state HR and would bias the fraction upward.
  const sleepIntervals = timeline
    .filter((s) => s.stageType !== "awake")
    .map((s) => ({
      startMs: new Date(s.startTime).getTime(),
      endMs: new Date(s.endTime).getTime(),
    }));

  const asleepSamples = binned.filter((s) =>
    sleepIntervals.some((iv) => s.timestamp >= iv.startMs && s.timestamp < iv.endMs)
  );

  if (asleepSamples.length < MIN_ASLEEP_MINUTES) return null;

  const avgAsleepBpm =
    asleepSamples.reduce((sum, s) => sum + s.bpm, 0) / asleepSamples.length;
  const belowCount = asleepSamples.filter((s) => s.bpm <= baselineRhr).length;
  const timeBelowBaselinePct = Math.round((belowCount / asleepSamples.length) * 100);
  const deviationFromBaseline = (avgAsleepBpm - baselineRhr) / baselineRhr;
  const strainRecoveryScore = Math.max(
    0,
    Math.min(100, Math.round((timeBelowBaselinePct / FULL_RECOVERY_BELOW_PCT) * 100))
  );

  return {
    avgAsleepBpm: Math.round(avgAsleepBpm * 10) / 10,
    deviationFromBaseline: parseFloat(deviationFromBaseline.toFixed(3)),
    timeBelowBaselinePct,
    asleepMinutes: asleepSamples.length,
    strainRecoveryScore,
  };
}
