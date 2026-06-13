// HR-derived restlessness detection.
//
// The Google Health v4 API does not export Fitbit's movement-based restlessness
// events — only the 5m+ AWAKE stage blocks come through. Intra-night heart rate
// samples (~1/min) are a physiological proxy: transient spikes above the local
// rolling baseline indicate movement arousals that never triggered a full stage
// transition. Pure function: no framework imports, no side effects.

import type { SleepStageInterval } from "./types";
import type { RestlessEvent } from "./restlessness";
import { medianOf, downsampleToMinuteBins } from "./utils";

// ---------------------------------------------------------------------------
// Tunable thresholds — documented so calibration rationale is preserved.
// ---------------------------------------------------------------------------

/** bpm above local rolling median that marks a sample "elevated". */
export const SPIKE_DELTA_BPM = 6;

/**
 * Maximum duration (minutes) for an HR-spike event to qualify as restlessness.
 * Events longer than this are more likely true awakenings or positional HR
 * artifacts, not micro-arousals.
 */
export const MAX_EVENT_MINUTES = 4;

/**
 * Events within this many minutes of an AWAKE stage block boundary are
 * excluded — they represent the HR ramp-up into a real awakening or the
 * settling period after returning to sleep, not independent restlessness.
 */
export const BUFFER_MINUTES = 2;

/** Events separated by less than this are merged into one. */
const MERGE_GAP_MINUTES = 1;

/** Half-width of the centered median window (±5 min). */
const ROLLING_WINDOW_MINUTES = 5;

const MAX_EVENT_MS    = MAX_EVENT_MINUTES * 60_000;
const BUFFER_MS       = BUFFER_MINUTES * 60_000;
const MERGE_GAP_MS    = MERGE_GAP_MINUTES * 60_000;
const ROLLING_WINDOW_MS = ROLLING_WINDOW_MINUTES * 60_000;

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function detectHrRestlessness(
  samples: { timestamp: number; bpm: number }[],
  timeline: SleepStageInterval[]
): RestlessEvent[] {
  if (samples.length < 2) return [];

  // Downsample to 1-min bins — shared helper eliminates the ~2.5 Hz raw noise
  // while preserving the minute-level HR shape the algorithm operates on.
  const sorted = downsampleToMinuteBins(samples);
  if (sorted.length < 2) return [];

  // Each downsampled point represents one minute.
  const sampleIntervalMs = 60_000;

  // Pre-compute buffered AWAKE intervals: extend each block's edges by BUFFER_MS
  // so events that are only the HR lead-in/lead-out of a real awakening are dropped.
  const bufferedAwake = timeline
    .filter((s) => s.stageType === "awake")
    .map((s) => ({
      startMs: new Date(s.startTime).getTime() - BUFFER_MS,
      endMs: new Date(s.endTime).getTime() + BUFFER_MS,
    }));

  // ---------------------------------------------------------------------------
  // Step 1: Mark elevated samples via a centered ±5-minute rolling median.
  // ---------------------------------------------------------------------------
  const elevated: boolean[] = sorted.map((sample) => {
    const windowBpm = sorted
      .filter((s) => Math.abs(s.timestamp - sample.timestamp) <= ROLLING_WINDOW_MS)
      .map((s) => s.bpm);
    const base = medianOf(windowBpm);
    return sample.bpm >= base + SPIKE_DELTA_BPM;
  });

  // ---------------------------------------------------------------------------
  // Step 2: Group consecutive elevated samples into raw candidate events.
  // The end of each event is estimated as the last elevated sample's timestamp
  // plus one sample interval (to give single-sample events a non-zero duration).
  // ---------------------------------------------------------------------------
  type RawEvent = { startTs: number; endTs: number };
  const rawEvents: RawEvent[] = [];
  let eventStart: number | null = null;
  let lastTs: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    if (elevated[i]) {
      if (eventStart === null) eventStart = sorted[i].timestamp;
      lastTs = sorted[i].timestamp;
    } else if (eventStart !== null) {
      rawEvents.push({ startTs: eventStart, endTs: lastTs! + sampleIntervalMs });
      eventStart = null;
      lastTs = null;
    }
  }
  if (eventStart !== null) {
    rawEvents.push({ startTs: eventStart, endTs: lastTs! + sampleIntervalMs });
  }

  // ---------------------------------------------------------------------------
  // Step 3: Filter — duration cap + awake-proximity exclusion.
  // ---------------------------------------------------------------------------
  const filtered = rawEvents.filter((e) => {
    if (e.endTs - e.startTs > MAX_EVENT_MS) return false;
    // Drop if the event overlaps the buffered awake zone of any stage block.
    return !bufferedAwake.some((a) => e.startTs < a.endMs && e.endTs > a.startMs);
  });

  // ---------------------------------------------------------------------------
  // Step 4: Merge events separated by less than MERGE_GAP_MS.
  // ---------------------------------------------------------------------------
  const merged: RawEvent[] = [];
  for (const event of filtered) {
    const prev = merged[merged.length - 1];
    if (prev && event.startTs - prev.endTs < MERGE_GAP_MS) {
      merged[merged.length - 1] = { startTs: prev.startTs, endTs: event.endTs };
    } else {
      merged.push({ ...event });
    }
  }

  // Re-apply the duration cap after merging (merged events can exceed MAX_EVENT_MINUTES).
  return merged
    .filter((e) => e.endTs - e.startTs <= MAX_EVENT_MS)
    .map((e) => ({
      startTime: new Date(e.startTs).toISOString(),
      endTime: new Date(e.endTs).toISOString(),
      durationMs: e.endTs - e.startTs,
    }));
}
