import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchGoogleZoneRecords } from "@/lib/google/client";
import { normalizeZoneRecords } from "@/lib/google/normalizers";
import { aggregateZoneMinutes } from "@/lib/analytics/activity";
import { persistActivitySummaries } from "@/lib/sync/persist";
import { localToday, addDays } from "@/lib/dates";

const MAX_DAYS = 365;

/**
 * GET /api/backfill-zones?days=N
 *
 * One-time backfill: iterates N civil days backwards from today, fetches
 * time-in-heart-rate-zone via reconcile, and upserts one daily_activity_summaries
 * row per worn day. Days with no records (device off or beyond retention) are
 * skipped — they stay absent in the table, not stored as phantom zeros.
 *
 * Uses a 48-hour UTC fetch window per civil day (±12 UTC-hours of buffer)
 * so the correct civil-day records are captured regardless of the user's
 * timezone offset (covers UTC±11). Results are then filtered client-side by
 * the API's own civilStartTime.date before aggregation.
 *
 * Paced at 200 ms between days to respect Google Health rate limits.
 * Re-running is safe — upsert semantics.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const rawDays = searchParams.get("days");
  const days = rawDays
    ? Math.max(1, Math.min(MAX_DAYS, parseInt(rawDays, 10)))
    : 90;

  const today = localToday();

  type DayResult =
    | { date: string; status: "upserted"; records: number; light: number; moderate: number; vigorous: number; peak: number }
    | { date: string; status: "gap"; records: number }
    | { date: string; status: "error"; error: string };

  const results: DayResult[] = [];
  let upserted = 0;
  let gaps = 0;
  let errors = 0;

  for (let i = 0; i < days; i++) {
    const targetDate = addDays(today, -i);

    // 48-hour UTC window centered on the target civil day.
    // addDays produces "YYYY-MM-DD"; appending a literal UTC time is safe
    // (never uses new Date("YYYY-MM-DD") or toISOString for calendar dates).
    const windowStart = addDays(targetDate, -1) + "T12:00:00Z";
    const windowEnd   = addDays(targetDate,  1) + "T12:00:00Z";

    try {
      const raw = await fetchGoogleZoneRecords(userId, windowStart, windowEnd);
      const allRecords = normalizeZoneRecords(raw);

      // Filter to only the records whose civil date matches today's target.
      // The API populates civilStartTime.date with the user's local calendar
      // date, so this is authoritative — no additional UTC math needed.
      const dayRecords = allRecords.filter((r) => r.civilDate === targetDate);

      if (dayRecords.length === 0) {
        // No records for this civil day: device not worn, or beyond retention.
        // Leave absent — do NOT store a zero row (would corrupt trend gaps).
        console.log(`[backfill-zones] ${targetDate}  GAP  (${raw.length} raw pts in window, 0 for date)`);
        results.push({ date: targetDate, status: "gap", records: 0 });
        gaps++;
      } else {
        const zones = aggregateZoneMinutes(dayRecords);
        await persistActivitySummaries(userId, [{
          activityDate:    targetDate,
          lightMinutes:    zones.light,
          moderateMinutes: zones.moderate,
          vigorousMinutes: zones.vigorous,
          peakMinutes:     zones.peak,
        }]);
        console.log(
          `[backfill-zones] ${targetDate}  STORED  records=${dayRecords.length}` +
          `  L=${zones.light} M=${zones.moderate} V=${zones.vigorous} P=${zones.peak}`,
        );
        results.push({
          date: targetDate, status: "upserted", records: dayRecords.length,
          light: zones.light, moderate: zones.moderate,
          vigorous: zones.vigorous, peak: zones.peak,
        });
        upserted++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[backfill-zones] ${targetDate}  ERROR  ${msg}`);
      results.push({ date: targetDate, status: "error", error: msg });
      errors++;
    }

    // Pace between day fetches to respect API rate limits.
    if (i < days - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }
  }

  return NextResponse.json({
    days,
    upserted,
    gaps,
    errors,
    results,
  });
}
