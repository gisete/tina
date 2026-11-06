// Pure helpers for storing workout heart-rate samples. No DB, Next or Google imports.
//
// Heart rate is one stream: a night's samples come ONLY from the night fetch
// (ensureNightSamples). A workout window that overlaps a stored sleep session
// must therefore not write the overlapping readings, otherwise they would be
// counted toward that night's "cached" threshold.

/** A closed instant interval, e.g. a stored sleep session's start_time..end_time. */
export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface TimedSample {
  timestamp: Date;
  bpm: number;
}

/**
 * Drops every sample whose timestamp falls inside any window. Bounds are
 * inclusive on both ends, matching the night-sample query (gte start, lte end)
 * so a boundary sample is never claimed by both sources.
 */
export function excludeSamplesInWindows<T extends TimedSample>(samples: T[], windows: TimeWindow[]): T[] {
  if (windows.length === 0) return samples;
  const spans = windows.map((w) => [w.start.getTime(), w.end.getTime()] as const);
  return samples.filter((s) => {
    const t = s.timestamp.getTime();
    return !spans.some(([a, b]) => t >= a && t <= b);
  });
}

/** Pause between consecutive per-workout Google calls (sequential, never parallel). */
export const WORKOUT_HR_PAUSE_MS = 250;
