// Pure normalizers for Google Health `exercise` data points and the daily
// calorie rollups. No DB, Next or Google-client imports.
//
// Shapes are taken from the Task 13 probe (docs/exercise-probe/). Key facts:
//  - exercise points carry NO civil start time; the local date is derived from
//    startTime + startUtcOffset;
//  - int64 values arrive as strings, durations as "1536s";
//  - a field Google does not fill is absent. Absent stays null here, never 0
//    (a real "0s" zone duration is a measured zero and is kept as 0).

import { parseUtcOffsetSeconds } from "./normalizers";

// ---------------------------------------------------------------------------
// Raw shapes
// ---------------------------------------------------------------------------

export interface GoogleExercisePoint {
  /** "users/<id>/dataTypes/exercise/dataPoints/<dataPointId>" */
  name?: string;
  dataSource?: { recordingMethod?: string };
  exercise?: {
    interval?: {
      startTime?: string;
      startUtcOffset?: string;
      endTime?: string;
      endUtcOffset?: string;
    };
    exerciseType?: string;
    displayName?: string;
    /** "1536s" */
    activeDuration?: string;
    metricsSummary?: {
      caloriesKcal?: number | string;
      distanceMillimeters?: number | string;
      steps?: number | string;
      averagePaceSecondsPerMeter?: number | string;
      averageHeartRateBeatsPerMinute?: number | string;
      activeZoneMinutes?: number | string;
      heartRateZoneDurations?: {
        lightTime?: string;
        moderateTime?: string;
        vigorousTime?: string;
        peakTime?: string;
      };
    };
  };
}

/** One point from a calorie `dailyRollUp` (`total-calories` or `active-energy-burned`). */
export interface GoogleEnergyRollupPoint {
  civilStartTime?: { date?: { year?: number; month?: number; day?: number } };
  totalCalories?: { kcalSum?: number | string };
  activeEnergyBurned?: { kcalSum?: number | string };
}

// ---------------------------------------------------------------------------
// Normalized shapes (mirror the exercise_sessions / daily_energy columns)
// ---------------------------------------------------------------------------

export interface NormalizedExerciseSession {
  googleDataPointId: string;
  /** Local "YYYY-MM-DD" of the start (startTime + startUtcOffset). */
  exerciseDate: string;
  exerciseType: string;
  displayName: string | null;
  startTime: Date;
  endTime: Date;
  startUtcOffsetSeconds: number;
  endUtcOffsetSeconds: number | null;
  activeDurationSeconds: number;
  /** Google's own session calories, never summed from active-energy points. */
  caloriesKcal: number | null;
  distanceMeters: number | null;
  steps: number | null;
  avgHeartRateBpm: number | null;
  avgPaceSecondsPerMeter: number | null;
  activeZoneMinutes: number | null;
  lightZoneSeconds: number | null;
  moderateZoneSeconds: number | null;
  vigorousZoneSeconds: number | null;
  peakZoneSeconds: number | null;
  recordingMethod: string;
}

export interface NormalizedDailyEnergy {
  /** "YYYY-MM-DD" from the API's civilStartTime.date. */
  energyDate: string;
  totalCaloriesKcal: number | null;
  activeCaloriesKcal: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Local calendar date of an instant on the clock of the given UTC offset.
 * Offset-shifted Date read with UTC getters, never toISOString or
 * `new Date("YYYY-MM-DD")`. Unlike `nightOf`, there is no night boundary:
 * a 00:30 workout belongs to that calendar day.
 */
export function civilDateAtOffset(utcMs: number, offsetSeconds: number): string {
  const d = new Date(utcMs + offsetSeconds * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Finite number from a JSON number or numeric string; anything else is null (never 0). */
function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** "1536s" or "1536.5s" -> whole seconds; missing or malformed -> null. */
export function parseDurationSeconds(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(raw.trim());
  return m ? Math.round(Number(m[1])) : null;
}

/** Last path segment of a data point `name`, or null. */
function dataPointId(name: string | undefined): string | null {
  if (!name) return null;
  const id = name.split("/").pop();
  return id ? id : null;
}

const roundInt = (n: number | null): number | null => (n === null ? null : Math.round(n));

// ---------------------------------------------------------------------------
// Exercise sessions
// ---------------------------------------------------------------------------

/**
 * Maps one data point, or null when it lacks what the table needs as NOT NULL
 * (id, start/end instants, start offset, activeDuration, type, recording method).
 */
export function normalizeExercisePoint(point: GoogleExercisePoint): NormalizedExerciseSession | null {
  const ex = point.exercise;
  const id = dataPointId(point.name);
  const method = point.dataSource?.recordingMethod;
  if (!ex || !id || !method || !ex.exerciseType) return null;

  const startMs = Date.parse(ex.interval?.startTime ?? "");
  const endMs = Date.parse(ex.interval?.endTime ?? "");
  const startOffset = parseUtcOffsetSeconds(ex.interval?.startUtcOffset);
  const active = parseDurationSeconds(ex.activeDuration);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startOffset === null || active === null) return null;

  const m = ex.metricsSummary;
  const zones = m?.heartRateZoneDurations;
  const distanceMm = toNumber(m?.distanceMillimeters);

  return {
    googleDataPointId: id,
    exerciseDate: civilDateAtOffset(startMs, startOffset),
    exerciseType: ex.exerciseType,
    displayName: ex.displayName ? ex.displayName : null,
    startTime: new Date(startMs),
    endTime: new Date(endMs),
    startUtcOffsetSeconds: startOffset,
    endUtcOffsetSeconds: parseUtcOffsetSeconds(ex.interval?.endUtcOffset),
    activeDurationSeconds: active,
    caloriesKcal: toNumber(m?.caloriesKcal),
    distanceMeters: distanceMm === null ? null : distanceMm / 1000,
    steps: roundInt(toNumber(m?.steps)),
    avgHeartRateBpm: toNumber(m?.averageHeartRateBeatsPerMinute),
    avgPaceSecondsPerMeter: toNumber(m?.averagePaceSecondsPerMeter),
    activeZoneMinutes: roundInt(toNumber(m?.activeZoneMinutes)),
    // When Google omits the whole object, all four stay null (a real "0s" is 0).
    lightZoneSeconds: parseDurationSeconds(zones?.lightTime),
    moderateZoneSeconds: parseDurationSeconds(zones?.moderateTime),
    vigorousZoneSeconds: parseDurationSeconds(zones?.vigorousTime),
    peakZoneSeconds: parseDurationSeconds(zones?.peakTime),
    recordingMethod: method,
  };
}

export interface NormalizedExerciseBatch {
  sessions: NormalizedExerciseSession[];
  /** Points dropped for missing required fields; the caller logs this. */
  skipped: number;
}

/** Batch entry point: ascending by start time, one entry per data point ID. */
export function normalizeExercisePoints(points: GoogleExercisePoint[]): NormalizedExerciseBatch {
  const byId = new Map<string, NormalizedExerciseSession>();
  let skipped = 0;
  for (const p of points) {
    const s = normalizeExercisePoint(p);
    if (s === null) skipped++;
    else byId.set(s.googleDataPointId, s);
  }
  const sessions = [...byId.values()].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return { sessions, skipped };
}

// ---------------------------------------------------------------------------
// Daily energy
// ---------------------------------------------------------------------------

function rollupDate(pt: GoogleEnergyRollupPoint): string | null {
  const d = pt.civilStartTime?.date;
  if (!d?.year || !d.month || !d.day) return null;
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

/**
 * Merges the two calorie rollups into one row per civil day. A day present in
 * only one rollup keeps the other column null (not fetched/omitted, not zero).
 */
export function normalizeDailyEnergy(
  totalPoints: GoogleEnergyRollupPoint[],
  activePoints: GoogleEnergyRollupPoint[],
): NormalizedDailyEnergy[] {
  const byDate = new Map<string, NormalizedDailyEnergy>();
  const row = (date: string): NormalizedDailyEnergy => {
    let r = byDate.get(date);
    if (!r) {
      r = { energyDate: date, totalCaloriesKcal: null, activeCaloriesKcal: null };
      byDate.set(date, r);
    }
    return r;
  };

  for (const pt of totalPoints) {
    const date = rollupDate(pt);
    const kcal = toNumber(pt.totalCalories?.kcalSum);
    if (date !== null && kcal !== null && kcal >= 0) row(date).totalCaloriesKcal = kcal;
  }
  for (const pt of activePoints) {
    const date = rollupDate(pt);
    const kcal = toNumber(pt.activeEnergyBurned?.kcalSum);
    if (date !== null && kcal !== null && kcal >= 0) row(date).activeCaloriesKcal = kcal;
  }

  return [...byDate.values()].sort((a, b) => a.energyDate.localeCompare(b.energyDate));
}
