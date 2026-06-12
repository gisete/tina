// Overnight cardiovascular summary for the selected night.
//
// Resting heart rate and HRV are measured during sleep, so the daily reading
// dated the morning the user woke up describes that night. This engine pairs
// the reading with its 7-day rolling baseline (already computed by the heart
// analytics) and condenses both into a 0-100 cardiac recovery score that can
// feed the holistic sleep score.

import type { DailyHeartAnalysis } from "@/lib/analytics/heart";

export type NightHeartStatus = "recovering" | "typical" | "strained" | "insufficient";

export interface NightHeartSummary {
  /** Calendar date of the reading (the wake-up morning). */
  date: string | null;
  restingHr: number | null;
  hrv: number | null;
  baselineRhr: number | null;
  baselineHrv: number | null;
  /**
   * 0-100. At-or-better-than-baseline readings score 100; an RHR 10% above
   * baseline alone maps to 60 (the same threshold the heart engine flags as
   * "Elevated Stress"), a 10% HRV drop alone to 70. Null when neither metric
   * has both a reading and a baseline.
   */
  recoveryScore: number | null;
  status: NightHeartStatus;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Lower-is-better: percentage above baseline costs 4 points per point of deviation ×100. */
function rhrComponent(rhr: number | null, baseline: number | null): number | null {
  if (rhr === null || baseline === null || baseline <= 0) return null;
  const deviation = (rhr - baseline) / baseline; // positive = elevated = worse
  return clamp(Math.round(100 - deviation * 400), 0, 100);
}

/** Higher-is-better: percentage below baseline costs 3 points per point of deviation ×100. */
function hrvComponent(hrv: number | null, baseline: number | null): number | null {
  if (hrv === null || baseline === null || baseline <= 0) return null;
  const deviation = (baseline - hrv) / baseline; // positive = suppressed = worse
  return clamp(Math.round(100 - deviation * 300), 0, 100);
}

/**
 * @param daily   Per-day heart analyses, any order (looked up by date).
 * @param wakeDate Calendar date ("YYYY-MM-DD") of the morning the user woke
 *                 up from the night being scored.
 */
export function calculateNightHeartSummary(
  daily: DailyHeartAnalysis[],
  wakeDate: string
): NightHeartSummary {
  const day = daily.find((d) => d.date === wakeDate) ?? null;

  const insufficient: NightHeartSummary = {
    date: day?.date ?? null,
    restingHr: day?.rhr ?? null,
    hrv: day?.hrv ?? null,
    baselineRhr: day?.baselineRhr ?? null,
    baselineHrv: day?.baselineHrv ?? null,
    recoveryScore: null,
    status: "insufficient",
  };
  if (!day) return insufficient;

  const components = [
    rhrComponent(day.rhr, day.baselineRhr),
    hrvComponent(day.hrv, day.baselineHrv),
  ].filter((c): c is number => c !== null);

  if (components.length === 0) return insufficient;

  const recoveryScore = Math.round(
    components.reduce((sum, c) => sum + c, 0) / components.length
  );

  let status: NightHeartStatus = "typical";
  if (recoveryScore >= 85) status = "recovering";
  else if (recoveryScore < 60) status = "strained";

  return { ...insufficient, recoveryScore, status };
}
