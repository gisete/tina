// Restlessness analysis — distinguishes brief mid-night stirring from true
// awakenings, following the Google Health definition.
//
// A mid-night awake interval SHORTER than 5 minutes is "restlessness"; one of
// 5 minutes or longer is a true "awakening" (strict boundary: < 5m → restless,
// >= 5m → awakening). Awake blocks at the session boundaries — before sleep
// onset and after the final wake — are neither; they're onset/wake time, not
// mid-night disruption. Pure function: no framework imports, no side effects.

import type { SleepStageInterval } from "./types";

/** Strict boundary: awake intervals shorter than this are restlessness, not awakenings. */
export const RESTLESS_MAX_MINUTES = 5;
const RESTLESS_MAX_MS = RESTLESS_MAX_MINUTES * 60_000;

// Disruption index penalties — exported so assemble.ts can recompute when
// HR-derived restless events are merged with stage-derived awakenings.
/** Each brief stir costs a small fixed amount. */
export const RESTLESS_EVENT_PENALTY = 3;
/** Each true awakening costs more — a full wake is more disruptive than a stir. */
export const AWAKENING_EVENT_PENALTY = 10;
/** Plus one point per minute spent awake mid-night, regardless of the split. */
export const AWAKE_MINUTE_PENALTY = 1;

/** A single brief mid-night stir — plain JSON-safe primitives. */
export interface RestlessEvent {
  /** ISO 8601 */
  startTime: string;
  /** ISO 8601 */
  endTime: string;
  durationMs: number;
}

export interface RestlessnessAnalysis {
  /**
   * Brief restless stirs detected by the active source. Empty when source is
   * "none" (no HR data). Populated by HR-spike detection when source is
   * "hr-estimated".
   */
  restlessEvents: RestlessEvent[];
  restlessCount: number;
  restlessTotalMinutes: number;
  awakeningCount: number;
  awakeningTotalMinutes: number;
  /**
   * 0-100, where 100 = no mid-night disruption. Combines HR-derived restless
   * events and stage-derived awakenings via named penalty constants.
   */
  disruptionIndex: number;
  /**
   * How restless events were detected. "none" = no intra-night HR samples
   * available (restlessEvents will be empty). "hr-estimated" = detected from
   * transient HR spikes above rolling baseline.
   */
  source: "none" | "hr-estimated";
}

/**
 * Computes the 0-100 disruption index from combined restless + awakening counts.
 * Used both inside `calculateRestlessness` and in assemble.ts when HR-derived
 * restless events override the stage-only baseline.
 */
export function computeDisruptionIndex(
  restlessCount: number,
  restlessMinutes: number,
  awakeningCount: number,
  awakeningMinutes: number
): number {
  const penalty =
    restlessCount * RESTLESS_EVENT_PENALTY +
    awakeningCount * AWAKENING_EVENT_PENALTY +
    (restlessMinutes + awakeningMinutes) * AWAKE_MINUTE_PENALTY;
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

/** Index of the last element matching `pred`, or -1 (findLastIndex isn't in our TS lib target). */
function lastIndexWhere<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

/**
 * Classifies mid-night AWAKE stage blocks as true awakenings (≥5m) and sets
 * restless metrics to zero / source "none". When intra-night HR samples are
 * available, assemble.ts overwrites `restlessEvents` with HR-derived events via
 * `detectHrRestlessness` and sets `source: "hr-estimated"`.
 */
export function calculateRestlessness(timeline: SleepStageInterval[]): RestlessnessAnalysis {
  const empty: RestlessnessAnalysis = {
    restlessEvents: [],
    restlessCount: 0,
    restlessTotalMinutes: 0,
    awakeningCount: 0,
    awakeningTotalMinutes: 0,
    disruptionIndex: 100,
    source: "none",
  };

  if (timeline.length === 0) return empty;

  const sorted = [...timeline].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  // Boundary awake blocks live before the first / after the last actual sleep
  // stage. Anything strictly between those indices is mid-night disruption.
  const firstSleepIdx = sorted.findIndex((s) => s.stageType !== "awake");
  const lastSleepIdx = lastIndexWhere(sorted, (s) => s.stageType !== "awake");

  // No sleep recorded at all → every awake block is boundary time.
  if (firstSleepIdx === -1) return empty;

  let awakeningCount = 0;
  let awakeningMs = 0;

  for (let i = 0; i < sorted.length; i++) {
    const block = sorted[i];
    if (block.stageType !== "awake") continue;
    // Exclude onset (before first sleep) and final-wake (after last sleep) blocks.
    if (i < firstSleepIdx || i > lastSleepIdx) continue;

    // Every remaining mid-night AWAKE block is a true awakening — the Google
    // Health export never contains sub-5m AWAKE blocks (confirmed by API probe).
    awakeningCount++;
    awakeningMs += block.durationMs;
  }

  const awakeningMinutes = awakeningMs / 60_000;

  return {
    // restlessEvents stays empty until assemble.ts overwrites them with
    // HR-derived events (source: "hr-estimated").
    restlessEvents: [],
    restlessCount: 0,
    restlessTotalMinutes: 0,
    awakeningCount,
    awakeningTotalMinutes: Math.round(awakeningMinutes),
    disruptionIndex: computeDisruptionIndex(0, 0, awakeningCount, awakeningMinutes),
    source: "none",
  };
}
