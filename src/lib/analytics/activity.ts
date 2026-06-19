// Pure activity analytics — no React/Next/DB imports.
// primitives in, JSON-safe primitives out.

/**
 * Serializable shape of one row from daily_activity_summaries.
 * Defined here (not in read.ts) so client components can import the type
 * without bundling the server-only DB module.
 */
export interface DailyActivityRow {
  activityDate: string; // "YYYY-MM-DD"
  lightMinutes: number;
  moderateMinutes: number;
  vigorousMinutes: number;
  peakMinutes: number;
}

export type HrZoneType = "LIGHT" | "MODERATE" | "VIGOROUS" | "PEAK";

export interface ZoneMinutes {
  light: number;
  moderate: number;
  vigorous: number;
  peak: number;
}

export interface ZoneRecord {
  zoneType: HrZoneType;
  /** "YYYY-MM-DD" derived from the API's civilStartTime.date — never toISOString. */
  civilDate: string;
  /** Duration of this interval in whole minutes (normally 1). */
  durationMinutes: number;
}

/**
 * Fitbit AZM weighting — single source of truth for zone→weight mapping.
 * LIGHT = out-of-range (weight 0), MODERATE = fat-burn (1), VIGOROUS = cardio (2), PEAK (2).
 * Never duplicate this arithmetic in components or sync.
 */
export const ZONE_AZM_WEIGHT: Readonly<Record<HrZoneType, number>> = {
  LIGHT:    0,
  MODERATE: 1,
  VIGOROUS: 2,
  PEAK:     2,
};

/**
 * Sums per-zone minutes from an array of intraday records for ONE civil day.
 * Callers are responsible for pre-filtering records to a single date.
 */
export function aggregateZoneMinutes(records: ZoneRecord[]): ZoneMinutes {
  const result: ZoneMinutes = { light: 0, moderate: 0, vigorous: 0, peak: 0 };
  for (const r of records) {
    const m = r.durationMinutes;
    switch (r.zoneType) {
      case "LIGHT":    result.light    += m; break;
      case "MODERATE": result.moderate += m; break;
      case "VIGOROUS": result.vigorous += m; break;
      case "PEAK":     result.peak     += m; break;
    }
  }
  return result;
}

/**
 * Applies Fitbit's AZM weighting to per-zone minute totals.
 * Returns a non-negative integer (fractional minutes are floored by Math.round at ingest).
 */
export function calculateActiveZoneMinutes(zones: ZoneMinutes): number {
  return (
    zones.light    * ZONE_AZM_WEIGHT.LIGHT    +
    zones.moderate * ZONE_AZM_WEIGHT.MODERATE +
    zones.vigorous * ZONE_AZM_WEIGHT.VIGOROUS +
    zones.peak     * ZONE_AZM_WEIGHT.PEAK
  );
}
