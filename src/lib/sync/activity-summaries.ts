// Pure: raw zone-minute points → one activity-summary row per civil day.
// Same aggregation runGoogleSync applies inline; zone mapping is unchanged.

import { normalizeZoneRecords, type GoogleZoneMinutePoint } from "@/lib/google/normalizers";
import { aggregateZoneMinutes } from "@/lib/analytics/activity";

export interface ZoneSummaryRow {
  activityDate: string;
  lightMinutes: number;
  moderateMinutes: number;
  vigorousMinutes: number;
  peakMinutes: number;
}

export function buildActivitySummaries(points: GoogleZoneMinutePoint[]): ZoneSummaryRow[] {
  const records = normalizeZoneRecords(points);
  const byDate = new Map<string, typeof records>();
  for (const r of records) {
    const bucket = byDate.get(r.civilDate) ?? [];
    bucket.push(r);
    byDate.set(r.civilDate, bucket);
  }
  return [...byDate.entries()].map(([activityDate, recs]) => {
    const zones = aggregateZoneMinutes(recs);
    return {
      activityDate,
      lightMinutes: zones.light,
      moderateMinutes: zones.moderate,
      vigorousMinutes: zones.vigorous,
      peakMinutes: zones.peak,
    };
  });
}
