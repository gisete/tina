// Pure HR trend analytics engine — zero framework/DB imports.
// Feed it DailyHrSummary[] fixtures in tests; the engine is fully deterministic.

import { addDays } from "@/lib/dates";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HrWindow = "week" | "month" | "90d";

export type HrMetric = "rhr" | "hrv";

/**
 * +1 means higher values are better (HRV); -1 means lower values are better (RHR).
 * Never hardcode metric direction in components — always derive from this constant.
 */
export const METRIC_DIRECTION: Record<HrMetric, 1 | -1> = {
  rhr: -1,
  hrv: 1,
};

/**
 * Returns whether a delta represents an improvement, decline, or neutral change
 * for the given metric. Null delta and zero are both "neutral".
 *
 * Single source of truth for direction logic — import this in any component that
 * needs to color or label a trend delta; do NOT inline the arithmetic.
 */
export function trendSentiment(
  metric: HrMetric,
  delta: number | null,
): "improvement" | "decline" | "neutral" {
  if (delta === null || delta === 0) return "neutral";
  return METRIC_DIRECTION[metric] * delta > 0 ? "improvement" : "decline";
}

export interface DailyHrSummary {
  date: string;              // YYYY-MM-DD
  restingHeartRate: number | null;
  hrv: number | null;
}

export interface HrTrendPoint {
  date: string;
  restingHeartRate: number | null;
  hrv: number | null;
}

export interface HrTrendStats {
  /** Average RHR in the window, rounded to 1 decimal (bpm). */
  windowAvgRhr: number | null;
  /** Average HRV in the window, rounded to nearest integer (ms). */
  windowAvgHrv: number | null;
  minRhr: number | null;
  maxRhr: number | null;
  minHrv: number | null;
  maxHrv: number | null;
  /** Count of days in the window that have a non-null restingHeartRate. */
  nightsWithData: number;
  /** Count of days in the window that have a non-null hrv reading. */
  nightsWithHrv: number;
  /** Average RHR over the equal-length window immediately preceding this one. */
  prevWindowAvgRhr: number | null;
  /** windowAvgRhr − prevWindowAvgRhr; null if either side has no data. */
  rhrDeltaVsPrev: number | null;
  /** Average HRV over the equal-length window immediately preceding this one (integer ms). */
  prevWindowAvgHrv: number | null;
  /** windowAvgHrv − prevWindowAvgHrv; null if either side has no data. */
  hrvDeltaVsPrev: number | null;
}

export interface HrTrendResult {
  window: HrWindow;
  /** One entry per calendar day in the window, ascending, nulls preserved. */
  points: HrTrendPoint[];
  stats: HrTrendStats;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WINDOW_DAYS: Record<HrWindow, number> = {
  week: 7,
  month: 30,
  "90d": 90,
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function compact(arr: (number | null)[]): number[] {
  return arr.filter((v): v is number => v !== null);
}

function avg(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Generic single-series trend (public API)
// ---------------------------------------------------------------------------

/** A date-value pair for any numeric series. */
export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  value: number | null;
}

export interface SeriesTrendStats {
  /** Rounded to 1 decimal. */
  windowAvg: number | null;
  min: number | null;
  max: number | null;
  /** Count of points in the window that have a non-null value. */
  pointsWithData: number;
  /** Average over the equal-length window immediately before this one. */
  prevWindowAvg: number | null;
  /** windowAvg − prevWindowAvg; null if either side has no data. */
  deltaVsPrev: number | null;
}

export interface SeriesTrendResult {
  window: HrWindow;
  /** One entry per calendar day in the window, ascending, nulls preserved. */
  points: SeriesPoint[];
  stats: SeriesTrendStats;
}

/**
 * Windowed trend statistics for a single numeric series.
 *
 * Mirrors the per-metric logic inside calculateHrTrends but for one series,
 * so score charts can reuse the same windowing engine without duplicating it.
 *
 * @param series - Raw points. Need not be sorted or contiguous; gaps become nulls.
 * @param window - Rolling window ending on `today`, inclusive.
 * @param today  - Anchor "YYYY-MM-DD". Passed in so the engine is deterministic.
 */
export function calculateSeriesTrend(
  series: SeriesPoint[],
  window: HrWindow,
  today: string,
): SeriesTrendResult {
  const len = WINDOW_DAYS[window];
  const windowStart = addDays(today, -(len - 1));

  const byDate = new Map<string, number | null>();
  for (const s of series) {
    byDate.set(s.date, s.value);
  }

  // One point per calendar day in [windowStart, today], ascending.
  const points: SeriesPoint[] = [];
  for (let i = 0; i < len; i++) {
    const d = addDays(windowStart, i);
    points.push({ date: d, value: byDate.get(d) ?? null });
  }

  const values = compact(points.map((p) => p.value));
  const windowAvg = values.length > 0 ? round1(avg(values)) : null;
  const min = values.length > 0 ? Math.min(...values) : null;
  const max = values.length > 0 ? Math.max(...values) : null;
  const pointsWithData = values.length;

  const prevEnd = addDays(windowStart, -1);
  const prevStart = addDays(prevEnd, -(len - 1));

  const prevValues: number[] = [];
  for (const [date, v] of byDate) {
    if (date >= prevStart && date <= prevEnd && v !== null) {
      prevValues.push(v as number);
    }
  }

  const prevWindowAvg = prevValues.length > 0 ? round1(avg(prevValues)) : null;
  const deltaVsPrev =
    windowAvg !== null && prevWindowAvg !== null
      ? round1(windowAvg - prevWindowAvg)
      : null;

  return {
    window,
    points,
    stats: { windowAvg, min, max, pointsWithData, prevWindowAvg, deltaVsPrev },
  };
}

// ---------------------------------------------------------------------------
// Dual-metric HR trend (public API)
// ---------------------------------------------------------------------------

/**
 * Computes rolling window trend statistics for daily resting HR and HRV.
 *
 * @param summaries - All available daily summaries. Need not be sorted or
 *   contiguous; the engine handles gaps without mutation.
 * @param window    - Rolling window length ending on `today`, inclusive.
 * @param today     - Anchor date as "YYYY-MM-DD". Passed in so the engine
 *   stays deterministic and testable against fixtures without side effects.
 */
export function calculateHrTrends(
  summaries: DailyHrSummary[],
  window: HrWindow,
  today: string,
): HrTrendResult {
  const len = WINDOW_DAYS[window];
  const windowStart = addDays(today, -(len - 1));

  const byDate = new Map<string, DailyHrSummary>();
  for (const s of summaries) {
    byDate.set(s.date, s);
  }

  // One point per calendar day in [windowStart, today], ascending
  const points: HrTrendPoint[] = [];
  for (let i = 0; i < len; i++) {
    const d = addDays(windowStart, i);
    const row = byDate.get(d);
    points.push({
      date: d,
      restingHeartRate: row?.restingHeartRate ?? null,
      hrv: row?.hrv ?? null,
    });
  }

  const windowRhrs = compact(points.map((p) => p.restingHeartRate));
  const windowHrvs = compact(points.map((p) => p.hrv));

  const windowAvgRhr = windowRhrs.length > 0 ? round1(avg(windowRhrs)) : null;
  const windowAvgHrv = windowHrvs.length > 0 ? Math.round(avg(windowHrvs)) : null;
  const minRhr = windowRhrs.length > 0 ? Math.min(...windowRhrs) : null;
  const maxRhr = windowRhrs.length > 0 ? Math.max(...windowRhrs) : null;
  const minHrv = windowHrvs.length > 0 ? Math.min(...windowHrvs) : null;
  const maxHrv = windowHrvs.length > 0 ? Math.max(...windowHrvs) : null;
  const nightsWithData = windowRhrs.length;
  const nightsWithHrv = windowHrvs.length;

  // Previous equal-length window immediately before the current one
  const prevEnd = addDays(windowStart, -1);
  const prevStart = addDays(prevEnd, -(len - 1));

  const prevRhrs: number[] = [];
  const prevHrvs: number[] = [];
  for (const [date, row] of byDate) {
    if (date >= prevStart && date <= prevEnd) {
      if (row.restingHeartRate !== null) prevRhrs.push(row.restingHeartRate);
      if (row.hrv !== null) prevHrvs.push(row.hrv);
    }
  }

  const prevWindowAvgRhr = prevRhrs.length > 0 ? round1(avg(prevRhrs)) : null;
  const rhrDeltaVsPrev =
    windowAvgRhr !== null && prevWindowAvgRhr !== null
      ? round1(windowAvgRhr - prevWindowAvgRhr)
      : null;

  const prevWindowAvgHrv = prevHrvs.length > 0 ? Math.round(avg(prevHrvs)) : null;
  const hrvDeltaVsPrev =
    windowAvgHrv !== null && prevWindowAvgHrv !== null
      ? windowAvgHrv - prevWindowAvgHrv
      : null;

  return {
    window,
    points,
    stats: {
      windowAvgRhr,
      windowAvgHrv,
      minRhr,
      maxRhr,
      minHrv,
      maxHrv,
      nightsWithData,
      nightsWithHrv,
      prevWindowAvgRhr,
      rhrDeltaVsPrev,
      prevWindowAvgHrv,
      hrvDeltaVsPrev,
    },
  };
}
