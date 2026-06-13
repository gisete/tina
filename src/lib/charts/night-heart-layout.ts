// Pure layout math for the overnight heart-rate curve.
//
// X positions are percentages of the session window (fluid width, same as the
// hypnogram); Y positions are fractions 0..1 of the plot height (0 = top).
// No DOM, no React — feed it samples and assert on the geometry in tests.

import { buildTimeTicks, type TimeTick } from "./time-ticks";

export interface NightHrSample {
  /** Unix milliseconds. */
  timestamp: number;
  bpm: number;
}

export interface NightHeartPoint extends NightHrSample {
  xPct: number;
  yFrac: number;
}

export interface NightHeartLayout {
  points: NightHeartPoint[];
  /** Horizontal scale gridlines, top to bottom. */
  yTicks: Array<{ bpm: number; yFrac: number }>;
  ticks: TimeTick[];
  /** Dashed marker at the usual resting heart rate, when one is known. */
  baseline: { bpm: number; yFrac: number } | null;
  /**
   * Percentage (0-100) of all night samples at or below the baseline RHR.
   * 0 when baseline is null. Used for the chart's summary copy.
   */
  timeBelowBaselinePct: number;
  minBpm: number;
  maxBpm: number;
}

/** Returns null when there are too few samples to draw a meaningful curve. */
export function buildNightHeartLayout(
  samples: NightHrSample[],
  sessionStart: string,
  sessionEnd: string,
  baselineRhr: number | null
): NightHeartLayout | null {
  if (samples.length < 2) return null;

  const startTs = new Date(sessionStart).getTime();
  const endTs   = new Date(sessionEnd).getTime();
  const spanMs  = Math.max(endTs - startTs, 1);

  const sorted = [...samples]
    .filter((s) => s.timestamp >= startTs && s.timestamp <= endTs)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return null;

  const bpms = sorted.map((s) => s.bpm);
  const minBpm = Math.min(...bpms);
  const maxBpm = Math.max(...bpms);

  // Scale domain: pad the observed range (and the baseline, so the marker is
  // always inside the plot), then snap to multiples of 5 for clean tick labels.
  const lo = Math.floor((Math.min(minBpm, baselineRhr ?? minBpm) - 3) / 5) * 5;
  const hi = Math.ceil((Math.max(maxBpm, baselineRhr ?? maxBpm) + 3) / 5) * 5;
  const domain = Math.max(hi - lo, 5);

  const yFrac = (bpm: number) => (hi - bpm) / domain;

  const points: NightHeartPoint[] = sorted.map((s) => ({
    ...s,
    xPct: ((s.timestamp - startTs) / spanMs) * 100,
    yFrac: yFrac(s.bpm),
  }));

  // At most ~5 horizontal gridlines, stepped in multiples of 5 bpm.
  const step = Math.max(5, Math.ceil(domain / 4 / 5) * 5);
  const yTicks: Array<{ bpm: number; yFrac: number }> = [];
  for (let bpm = lo; bpm <= hi; bpm += step) {
    yTicks.push({ bpm, yFrac: yFrac(bpm) });
  }

  // Fraction of samples at or below the usual resting rate.
  // Uses raw (non-downsampled) counts — noise averages out over thousands of
  // samples and the result is display-only (the scoring engine uses filtered
  // asleep-minute bins via calculateCardiacStrain).
  let timeBelowBaselinePct = 0;
  if (baselineRhr !== null && sorted.length > 0) {
    const belowCount = sorted.filter((s) => s.bpm <= baselineRhr).length;
    timeBelowBaselinePct = Math.round((belowCount / sorted.length) * 100);
  }

  return {
    points,
    yTicks,
    ticks: buildTimeTicks(startTs, endTs),
    baseline: baselineRhr !== null ? { bpm: baselineRhr, yFrac: yFrac(baselineRhr) } : null,
    timeBelowBaselinePct,
    minBpm,
    maxBpm,
  };
}
