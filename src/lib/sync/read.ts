// Read-only DB queries for health data. Parallel to persist.ts for writes.
// Takes userId as a plain parameter — callers handle auth before invoking.

import { db } from "@/db/client";
import { heartRateSummaries, dailyActivitySummaries } from "@/db/schema";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import type { DailyHrSummary } from "@/lib/analytics/hr-trends";
import type { DailyActivityRow } from "@/lib/analytics/activity";

/**
 * Returns heart-rate summaries for a user within a calendar-day range,
 * inclusive of both endpoints (heart_rate_summaries is a calendar-day table).
 *
 * Date bounds must be "YYYY-MM-DD" strings produced by the local-timezone
 * helpers in src/lib/dates — never toISOString().
 */
export async function readHrSummaries(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<DailyHrSummary[]> {
  const rows = await db.query.heartRateSummaries.findMany({
    where: and(
      eq(heartRateSummaries.userId, userId),
      gte(heartRateSummaries.date, startDate),
      lte(heartRateSummaries.date, endDate),
    ),
    orderBy: [asc(heartRateSummaries.date)],
  });

  return rows.map((r) => ({
    date: r.date,
    restingHeartRate: r.restingHeartRate,
    hrv: r.hrvRmssd,
  }));
}

/**
 * Returns per-zone minute totals for a user within a calendar-day range,
 * inclusive of both endpoints. Callers compute AZM live via
 * calculateActiveZoneMinutes — no stored AZM column is read here.
 */
export async function readActivitySummaries(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<DailyActivityRow[]> {
  const rows = await db.query.dailyActivitySummaries.findMany({
    where: and(
      eq(dailyActivitySummaries.userId, userId),
      gte(dailyActivitySummaries.activityDate, startDate),
      lte(dailyActivitySummaries.activityDate, endDate),
    ),
    orderBy: [asc(dailyActivitySummaries.activityDate)],
  });

  return rows.map((r) => ({
    activityDate:    r.activityDate,
    lightMinutes:    r.lightMinutes,
    moderateMinutes: r.moderateMinutes,
    vigorousMinutes: r.vigorousMinutes,
    peakMinutes:     r.peakMinutes,
  }));
}
