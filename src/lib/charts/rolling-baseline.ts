// Pure rolling "last N readings" baseline for trend charts — primitives in,
// primitives out. No React/Next/Recharts/DB imports.

import { addDays, diffDays } from "@/lib/dates";

/** A baseline averages at most this many readings (not days). */
export const BASELINE_READINGS = 7;
/** Fewer qualifying readings than this and the baseline is null (the chart bridges it). */
export const BASELINE_MIN_READINGS = 3;
/** Only readings dated within this many calendar days before the day count. */
export const BASELINE_LOOKBACK_DAYS = 28;

export interface DatedValue {
  /** Local "YYYY-MM-DD". */
  date: string;
  value: number | null;
}

export interface RollingBaselineOptions {
  readings?: number;
  minReadings?: number;
  lookbackDays?: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * One baseline per input point. The baseline for day D is the mean (1 decimal)
 * of the up to `readings` most recent non-null readings dated strictly before D
 * and no more than `lookbackDays` calendar days earlier. D's own value is
 * excluded, so a spike cannot pull its own baseline. Absent days are skipped,
 * not counted. Fewer than `minReadings` qualifying readings → null.
 * `points` must be ascending by date (gaps allowed).
 */
export function rollingReadingBaseline(
  points: readonly DatedValue[],
  opts: RollingBaselineOptions = {},
): (number | null)[] {
  const readings = opts.readings ?? BASELINE_READINGS;
  const minReadings = opts.minReadings ?? BASELINE_MIN_READINGS;
  const lookbackDays = opts.lookbackDays ?? BASELINE_LOOKBACK_DAYS;

  return points.map((p, i) => {
    const picked: number[] = [];
    for (let j = i - 1; j >= 0 && picked.length < readings; j--) {
      if (diffDays(points[j].date, p.date) > lookbackDays) break;
      const v = points[j].value;
      if (v !== null) picked.push(v);
    }
    if (picked.length < minReadings) return null;
    return round1(picked.reduce((s, v) => s + v, 0) / picked.length);
  });
}

/**
 * Baseline for exactly `dates` (ascending, contiguous window) computed over
 * `series` extended `lookbackDays` before the first date, so the window's first
 * days already see history. `series` may be unsorted and have gaps; days with no
 * entry are absent. Returns one value per entry of `dates`.
 */
export function rollingBaselineForWindow(
  series: readonly DatedValue[],
  dates: readonly string[],
  opts: RollingBaselineOptions = {},
): (number | null)[] {
  if (dates.length === 0) return [];
  const lookbackDays = opts.lookbackDays ?? BASELINE_LOOKBACK_DAYS;
  const byDate = new Map<string, number | null>();
  for (const s of series) byDate.set(s.date, s.value);

  const first = dates[0];
  const extended: DatedValue[] = [];
  for (let d = addDays(first, -lookbackDays); d < first; d = addDays(d, 1)) {
    extended.push({ date: d, value: byDate.get(d) ?? null });
  }
  for (const d of dates) extended.push({ date: d, value: byDate.get(d) ?? null });

  return rollingReadingBaseline(extended, opts).slice(lookbackDays);
}
