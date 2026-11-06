// Fetches and persists one inclusive range of local dates from Google Health.
// Used by the catch-up step and the manual ?days=N range sync. Throws unless EVERY fetch and persist
// succeeded, so a caller can treat a normal return as "range fully synced".
// Never fetches intra-night heart-rate samples.

import {
  fetchGoogleSleepData,
  fetchGoogleHeartData,
  fetchGoogleZoneRecords,
  fetchGoogleDailySteps,
  fetchGoogleExerciseSessions,
  fetchGoogleDailyEnergy,
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
import { persistExerciseSlice, type ExerciseRowCounts } from "@/lib/sync/exercise-range";
import { buildActivitySummaries } from "@/lib/sync/activity-summaries";
import { addDays, parseLocalDate } from "@/lib/dates";
import { splitRange } from "@/lib/sync/catch-up";

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
  for (const { from: start, to: end } of splitRange(from, to, ZONE_WINDOW_DAYS)) {
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

/** Rows handed to each upsert by one syncDateRange call (inserts and updates alike). */
export interface RangeRowCounts extends ExerciseRowCounts {
  sleepSessions: number;
  sleepStages: number;
  heartSummaries: number;
  /** daily_activity_summaries rows written with zone minutes. */
  activityZoneDays: number;
  /** daily_activity_summaries rows written with steps. */
  stepDays: number;
}

/**
 * Sleep is filtered on session END, so the night that starts on `to` ends after
 * this range and is fetched by the next unit (which always starts at to + 1).
 */
export async function syncDateRange(userId: string, from: string, to: string): Promise<RangeRowCounts> {
  // Whole local days, so per-day rows (zones replace, steps replace) are never
  // written from a partial day.
  const startISO = localMidnightISO(from);
  const endISO = localMidnightISO(addDays(to, 1));

  const results = await Promise.allSettled([
    fetchGoogleSleepData(userId, startISO, endISO),
    fetchGoogleHeartData(userId, startISO, endISO),
    fetchZonesInWindows(userId, from, to),
    fetchGoogleDailySteps(userId, from, addDays(to, 1)),
    fetchGoogleExerciseSessions(userId, from, addDays(to, 1)),
    fetchGoogleDailyEnergy(userId, from, addDays(to, 1)),
  ]);

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    const auth = failures.find((f) => f.reason instanceof GoogleAuthError);
    throw (auth ?? failures[0]).reason;
  }
  const [sleep, heart, zones, steps, exercise, energy] = results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as [
    Awaited<ReturnType<typeof fetchGoogleSleepData>>,
    Awaited<ReturnType<typeof fetchGoogleHeartData>>,
    GoogleZoneMinutePoint[],
    Awaited<ReturnType<typeof fetchGoogleDailySteps>>,
    Awaited<ReturnType<typeof fetchGoogleExerciseSessions>>,
    Awaited<ReturnType<typeof fetchGoogleDailyEnergy>>,
  ];

  const normalizedSleep = normalizeGoogleSleepSessions(userId, sleep);
  const heartRecords = normalizeHeartData(userId, heart.heartRatePoints, heart.hrvPoints);
  const activitySummaries = buildActivitySummaries(zones);
  const dailySteps = normalizeDailySteps(steps);

  await persistHealthRecords(userId, normalizedSleep, heartRecords);
  await persistActivitySummaries(userId, activitySummaries);
  await persistDailySteps(userId, dailySteps);

  // After sleep is persisted: workout samples inside a stored sleep window are skipped.
  const exerciseCounts = await persistExerciseSlice(userId, from, to, { exercise, energy });

  return {
    sleepSessions: normalizedSleep.length,
    sleepStages: normalizedSleep.reduce((n, s) => n + s.stages.length, 0),
    heartSummaries: heartRecords.length,
    activityZoneDays: activitySummaries.length,
    stepDays: dailySteps.length,
    ...exerciseCounts,
  };
}
