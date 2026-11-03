// Absence classification driven by the sync cursor — pure, primitives in/out.
// No React/Next/DB imports. Dates are local "YYYY-MM-DD" strings (string compare is
// valid for that format).

import { measured, unavailable, type MeasuredMetric, type MetricFlag, type UnavailableMetric, type UnavailableReason } from "./metric";

export interface AbsenceContext {
  /** sync_state.synced_through: latest date up to which synced coverage is contiguous; null = not tracked. */
  syncedThrough: string | null;
  /** Local today. */
  today: string;
}

/**
 * Why a date has no data: a date on or before the cursor was synced, so
 * nothing there means the device recorded nothing ("not_worn"); a date after
 * the cursor (or with no cursor) may simply not be fetched yet ("not_synced").
 */
export function classifyAbsence(date: string, ctx: AbsenceContext): Extract<UnavailableReason, "not_worn" | "not_synced"> {
  return ctx.syncedThrough !== null && date <= ctx.syncedThrough ? "not_worn" : "not_synced";
}

export interface DayMetricOptions {
  /** The value accumulates through the day (steps, AZM): flag it partial_day when the date is today. */
  accumulatesDuringDay?: boolean;
}

/**
 * A measured daily value or its honest absence. `null`/`undefined` is absence;
 * 0 is a real measured zero.
 */
export function dayMetric(
  value: number | null | undefined,
  unit: string,
  date: string,
  ctx: AbsenceContext,
  opts: DayMetricOptions = {},
): MeasuredMetric | UnavailableMetric {
  if (value === null || value === undefined) return unavailable(classifyAbsence(date, ctx));
  const flags: MetricFlag[] | undefined = opts.accumulatesDuringDay && date === ctx.today ? ["partial_day"] : undefined;
  return measured(value, unit, flags);
}
