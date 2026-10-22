// Fetches and persists one inclusive range of local dates from Google Health.
// Used by the catch-up step and the manual ?days=N range sync. Throws unless EVERY fetch and persist
// succeeded, so a caller can treat a normal return as "range fully synced".
// Never fetches intra-night heart-rate samples.

import {
  fetchGoogleSleepData,
  fetchGoogleHeartData,
  fetchGoogleZoneRecords,
  fetchGoogleDailySteps,
} from "@/lib/google/client";
import { GoogleAuthError } from "@/lib/google/errors";
import {
  normalizeGoogleSleepSessions,
  normalizeHeartData,
  normalizeDailySteps,
  type GoogleZoneMinutePoint,
} from "@/lib/google/normalizers";
import {
  persistHealthRecords,
  persistActivitySummaries,
  persistDailySteps,
} from "@/lib/sync/persist";
import { buildActivitySummaries } from "@/lib/sync/activity-summaries";
import { addDays, parseLocalDate } from "@/lib/dates";

/**
 * Days per zone request window. Zone data is ~1 point per worn minute and the
 * page helper silently stops at 20 pages x 1000 points, so a window must stay
 * well under that (7 days + 2 padding days ≈ 13,000 points ≈ 13 pages).
 */
const ZONE_WINDOW_DAYS = 7;

/** Instant of local midnight at the start of a civil date (an instant, not a calendar date). */
const localMidnightISO = (date: string): string => parseLocalDate(date).toISOString();

/** The API's own civil date for a zone point ("YYYY-MM-DD"), or null when absent. */
function zonePointCivilDate(pt: GoogleZoneMinutePoint): string | null {
  const d = pt.timeInHeartRateZone?.interval?.civilStartTime?.date;
  if (!d?.year || !d?.month || !d?.day) return null;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/**
 * Zones are requested per 7-day window, padded by one day on each side, and
 * each window keeps only points whose API civil date falls inside it. Google
 * assigns civil dates in the device's timezone, which can differ from the
 * server's: filtering by server-local-midnight instants alone then drops the
 * early hours of a window's first day (seen as ~8h missing on travel days).
 * Padding fetches the whole day; filtering by civil date keeps every day in
 * exactly one window, so seams never double-count.
 */
async function fetchZonesInWindows(userId: string, from: string, to: string): Promise<GoogleZoneMinutePoint[]> {
  const points: GoogleZoneMinutePoint[] = [];
  for (let start = from; start <= to; start = addDays(start, ZONE_WINDOW_DAYS)) {
    const last = addDays(start, ZONE_WINDOW_DAYS - 1);
    const end = last < to ? last : to;
    const fetched = await fetchGoogleZoneRecords(
      userId,
      localMidnightISO(addDays(start, -1)),
      localMidnightISO(addDays(end, 2)),
    );
    for (const pt of fetched) {
      const date = zonePointCivilDate(pt);
      if (date !== null && date >= start && date <= end) points.push(pt);
    }
  }
  return points;
}

/**
 * Sleep is filtered on session END, so the night that starts on `to` ends after
 * this range and is fetched by the next unit (which always starts at to + 1).
 */
export async function syncDateRange(userId: string, from: string, to: string): Promise<void> {
  // Whole local days, so per-day rows (zones replace, steps replace) are never
  // written from a partial day.
  const startISO = localMidnightISO(from);
  const endISO = localMidnightISO(addDays(to, 1));

  const results = await Promise.allSettled([
    fetchGoogleSleepData(userId, startISO, endISO),
    fetchGoogleHeartData(userId, startISO, endISO),
    fetchZonesInWindows(userId, from, to),
    fetchGoogleDailySteps(userId, from, addDays(to, 1)),
  ]);

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    const auth = failures.find((f) => f.reason instanceof GoogleAuthError);
    throw (auth ?? failures[0]).reason;
  }
  const [sleep, heart, zones, steps] = results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as [
    Awaited<ReturnType<typeof fetchGoogleSleepData>>,
    Awaited<ReturnType<typeof fetchGoogleHeartData>>,
    GoogleZoneMinutePoint[],
    Awaited<ReturnType<typeof fetchGoogleDailySteps>>,
  ];

  await persistHealthRecords(
    userId,
    normalizeGoogleSleepSessions(userId, sleep),
    normalizeHeartData(userId, heart.heartRatePoints, heart.hrvPoints),
  );
  await persistActivitySummaries(userId, buildActivitySummaries(zones));
  await persistDailySteps(userId, normalizeDailySteps(steps));
}
