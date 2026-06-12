// Stage-continuity scoring engines.
//
// Deep and REM share one weighted-block algorithm and differ only in their
// thresholds; light sleep is judged on stability (proportion + awakenings)
// rather than continuity. All functions here are pure — no framework imports,
// no side effects — so they can be unit-tested with plain fixture arrays.

import type { SleepStageInterval, SleepStageType } from "./types";

// ---------------------------------------------------------------------------
// Shared weighted-continuity core (deep + REM)
// ---------------------------------------------------------------------------

export type ContinuityStatus = "fragmented" | "standard" | "consolidated";

export interface StageContinuity {
  rawTotalMinutes: number;
  effectiveMinutes: number;
  continuityScore: number;
  fragmentationCount: number;
  /** Number of blocks at or above the stage's anchor threshold. */
  anchorCount: number;
  status: ContinuityStatus;
}

// Kept as named aliases so callers stay expressive about which engine fed them.
export type DeepSleepContinuity = StageContinuity;
export type RemSleepContinuity = StageContinuity;

export interface ContinuityThresholds {
  /** Blocks shorter than this many minutes count as fragments (0.5× weight). */
  fragmentBelowMins: number;
  /** Blocks at or above this many minutes count as anchors (1.2× weight). */
  anchorAtMins: number;
}

/** Deep sleep: fragments under 15m, anchors at 30m+. */
export const DEEP_CONTINUITY_THRESHOLDS: ContinuityThresholds = {
  fragmentBelowMins: 15,
  anchorAtMins: 30,
};

/**
 * REM cycles are naturally a bit shorter early in the night, so the penalty
 * threshold is slightly lower (10m) and the anchor threshold is 25m.
 */
export const REM_CONTINUITY_THRESHOLDS: ContinuityThresholds = {
  fragmentBelowMins: 10,
  anchorAtMins: 25,
};

/**
 * Weighted-block continuity score:
 *   fragments  (< fragmentBelowMins)        → 0.5× effective credit
 *   medium     (fragment..anchor threshold) → 0.8×
 *   anchors    (≥ anchorAtMins)             → 1.2×
 *
 * Score = effective / raw, as a percentage. A perfect 100 requires zero
 * fragmentation: each fragment lowers the score ceiling by 2 points so anchor
 * bonuses can never fully mask interruptions.
 */
export function scoreStageContinuity(
  blocks: SleepStageInterval[],
  thresholds: ContinuityThresholds
): StageContinuity {
  let rawTotalMs = 0;
  let effectiveTotalMs = 0;
  let fragCount = 0;
  let anchorCount = 0;

  for (const block of blocks) {
    rawTotalMs += block.durationMs;
    const mins = block.durationMs / 60000;
    if (mins < thresholds.fragmentBelowMins) {
      effectiveTotalMs += block.durationMs * 0.5;
      fragCount++;
    } else if (mins < thresholds.anchorAtMins) {
      effectiveTotalMs += block.durationMs * 0.8;
    } else {
      effectiveTotalMs += block.durationMs * 1.2;
      anchorCount++;
    }
  }

  const scoreCeiling = Math.max(0, 100 - fragCount * 2);
  const score = rawTotalMs > 0 ? Math.min((effectiveTotalMs / rawTotalMs) * 100, scoreCeiling) : 0;

  let status: ContinuityStatus = "standard";
  if (score >= 85) status = "consolidated";
  else if (score < 60) status = "fragmented";

  return {
    rawTotalMinutes: Math.round(rawTotalMs / 60000),
    // The 1.2 anchor bonus can push the weighted total above raw; cap the
    // reported value — "effective sleep" should never exceed time actually
    // logged. The score is unaffected (its ceiling already applies).
    effectiveMinutes: Math.round(Math.min(effectiveTotalMs, rawTotalMs) / 60000),
    continuityScore: Math.round(score),
    fragmentationCount: fragCount,
    anchorCount,
    status,
  };
}

function blocksOfStage(timeline: SleepStageInterval[], stage: SleepStageType): SleepStageInterval[] {
  return timeline.filter((b) => b.stageType === stage);
}

export function calculateDeepSleepContinuity(timeline: SleepStageInterval[]): DeepSleepContinuity {
  return scoreStageContinuity(blocksOfStage(timeline, "deep"), DEEP_CONTINUITY_THRESHOLDS);
}

export function calculateRemSleepContinuity(timeline: SleepStageInterval[]): RemSleepContinuity {
  return scoreStageContinuity(blocksOfStage(timeline, "rem"), REM_CONTINUITY_THRESHOLDS);
}

// ---------------------------------------------------------------------------
// Light-sleep stability
// ---------------------------------------------------------------------------

export interface LightSleepStability {
  totalMinutes: number;
  proportionPercentage: number;
  /** Awakenings that immediately follow a light block (light → awake transitions). */
  awakeningsCount: number;
  status: "optimal" | "elevated" | "disruptive";
}

export function calculateLightSleepStability(
  timeline: SleepStageInterval[],
  totalSleepMs: number
): LightSleepStability {
  let totalMs = 0;
  let awakeningsCount = 0;

  // Sort timeline chronologically to detect transitions
  const sorted = [...timeline].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  for (let i = 0; i < sorted.length; i++) {
    const block = sorted[i];
    if (block.stageType === "light") {
      totalMs += block.durationMs;
      if (sorted[i + 1] && sorted[i + 1].stageType === "awake") {
        awakeningsCount++;
      }
    }
  }

  const proportion = totalSleepMs > 0 ? (totalMs / totalSleepMs) * 100 : 0;

  let status: "optimal" | "elevated" | "disruptive" = "optimal";
  if (proportion > 65 || awakeningsCount > 5) status = "disruptive";
  else if (proportion > 60 || awakeningsCount > 3) status = "elevated";

  return {
    totalMinutes: Math.round(totalMs / 60000),
    proportionPercentage: Math.round(proportion),
    awakeningsCount,
    status,
  };
}
