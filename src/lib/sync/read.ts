// Read-only DB queries for health data. Parallel to persist.ts for writes.
// Takes userId as a plain parameter — callers handle auth before invoking.

import { db } from "@/db/client";
import { heartRateSummaries } from "@/db/schema";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import type { DailyHrSummary } from "@/lib/analytics/hr-trends";

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
