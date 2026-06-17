// Pure engine: assign intra-night HR samples to sleep stage intervals and
// compute a per-stage average bpm. No framework or DB imports.

import type { SleepStageType, SleepStageInterval } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StageHrEntry {
  /** Rounded-integer average bpm, or null when no samples fell in this stage. */
  avgBpm: number | null;
  /** Number of HR samples assigned to this stage. */
  sampleCount: number;
}

export interface StageHrMap {
  deep:  StageHrEntry;
  light: StageHrEntry;
  rem:   StageHrEntry;
  awake: StageHrEntry;
}

/** ISO interval boundaries converted to Unix ms — parse once, reuse everywhere. */
export interface ParsedInterval {
  stageType: SleepStageType;
  startMs: number;
  endMs: number;
}

// ---------------------------------------------------------------------------
// Shared assignment primitives (single source of truth for sample→stage logic)
// ---------------------------------------------------------------------------

/** Parse ISO interval boundaries to Unix ms once, avoiding repeated Date construction. */
export function parseIntervals(
  timeline: ReadonlyArray<SleepStageInterval>,
): ParsedInterval[] {
  return timeline.map((iv) => ({
    stageType: iv.stageType,
    startMs: new Date(iv.startTime).getTime(),
    endMs:   new Date(iv.endTime).getTime(),
  }));
}

/**
 * Half-open [startMs, endMs) lookup — the single definition of "which stage
 * does this timestamp belong to?" Returns null for gaps / outside-session samples.
 * Both the averaging engine and the chart coloring import and call this.
 */
export function findSampleStage(
  timestampMs: number,
  intervals: ReadonlyArray<ParsedInterval>,
): SleepStageType | null {
  for (const iv of intervals) {
    if (timestampMs >= iv.startMs && timestampMs < iv.endMs) return iv.stageType;
  }
  return null;
}

/**
 * Tags each sample with its sleep stage. Samples outside all intervals get null.
 * Generic over S so it preserves extra properties (e.g. xPct, yFrac on layout
 * points) — both the averaging engine and the gradient builder use this.
 */
export function tagSamplesWithStage<S extends { timestamp: number }>(
  samples: ReadonlyArray<S>,
  timeline: ReadonlyArray<SleepStageInterval>,
): Array<S & { stageType: SleepStageType | null }> {
  const intervals = parseIntervals(timeline);
  return samples.map((s) => ({
    ...s,
    stageType: findSampleStage(s.timestamp, intervals),
  }));
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Assigns each HR sample to the sleep stage interval containing its timestamp
 * and returns per-stage rounded-integer average bpm.
 *
 * Interval matching uses half-open [startMs, endMs) semantics via the shared
 * tagSamplesWithStage helper — see findSampleStage for boundary behaviour.
 * Samples outside every interval are excluded, not forced into any bucket.
 */
export function calculateStageHr(
  samples: ReadonlyArray<{ timestamp: number; bpm: number }>,
  timeline: ReadonlyArray<SleepStageInterval>,
): StageHrMap {
  const tagged = tagSamplesWithStage(samples, timeline);
  const buckets: Record<SleepStageType, number[]> = {
    deep: [], light: [], rem: [], awake: [],
  };
  for (const s of tagged) {
    if (s.stageType !== null) buckets[s.stageType].push(s.bpm);
  }
  return {
    deep:  toEntry(buckets.deep),
    light: toEntry(buckets.light),
    rem:   toEntry(buckets.rem),
    awake: toEntry(buckets.awake),
  };
}

function toEntry(bpms: number[]): StageHrEntry {
  if (bpms.length === 0) return { avgBpm: null, sampleCount: 0 };
  const sum = bpms.reduce((s, v) => s + v, 0);
  return { avgBpm: Math.round(sum / bpms.length), sampleCount: bpms.length };
}
