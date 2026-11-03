// Metric value union for the agent-facing API — plain JSON-safe types and tiny
// builders. No React/Next/DB imports. Every exposed number is one of these, so a
// reader can always tell "0" (a measured zero) from "no data" (unavailable).

/** Why a value is absent. */
export type UnavailableReason =
  /** Day is covered by the sync cursor (<= synced_through) but the device recorded nothing. */
  | "not_worn"
  /** Day is after the sync cursor (or the cursor is unknown): data may exist but has not been fetched yet. */
  | "not_synced"
  /** Derived from data we only fetch on demand (e.g. intra-night HR samples) and it is not stored. */
  | "not_fetched"
  /** The source does not provide this metric. */
  | "not_supported"
  /** The day is not over, so the figure cannot be final. */
  | "partial_day";

/** Qualifiers on a present value. */
export type MetricFlag = "partial_day";

export interface MeasuredMetric {
  status: "measured";
  value: number;
  unit: string;
  /** "partial_day": today's value so far; it can still change. */
  flags?: MetricFlag[];
}

export interface EstimatedMetric {
  status: "estimated";
  value: number;
  unit: string;
  /** How the estimate is made, in a short human-readable phrase. */
  method: string;
  flags?: MetricFlag[];
}

export interface DerivedMetric {
  status: "derived";
  value: number;
  unit: string;
  flags?: MetricFlag[];
}

export interface UnavailableMetric {
  status: "unavailable";
  reason: UnavailableReason;
}

export type MetricValue = MeasuredMetric | EstimatedMetric | DerivedMetric | UnavailableMetric;

export function measured(value: number, unit: string, flags?: MetricFlag[]): MeasuredMetric {
  return flags && flags.length > 0 ? { status: "measured", value, unit, flags } : { status: "measured", value, unit };
}

export function estimated(value: number, unit: string, method: string, flags?: MetricFlag[]): EstimatedMetric {
  return flags && flags.length > 0
    ? { status: "estimated", value, unit, method, flags }
    : { status: "estimated", value, unit, method };
}

export function derived(value: number, unit: string, flags?: MetricFlag[]): DerivedMetric {
  return flags && flags.length > 0 ? { status: "derived", value, unit, flags } : { status: "derived", value, unit };
}

export function unavailable(reason: UnavailableReason): UnavailableMetric {
  return { status: "unavailable", reason };
}
