// Pure exercise engine — primitives in, JSON-safe primitives out. No React/Next/DB imports.
//
// Rules (docs/plan.md Task 16):
//  - A session belongs to the LOCAL date of its start (stored `exerciseDate`); a workout crossing
//    midnight stays on its start date and is flagged `crossesMidnight`.
//  - Pace and speed come from the ACTIVE duration, never end minus start (a paused workout is shorter).
//  - Session calories are Google's own figure; active-energy points are never summed into them.
//  - Absent stays null, never 0. A distance of 0 for an activity with no distance is "no distance".
//  - Overlapping sessions are all kept (no dedupe); the daily rollup therefore sums them as-is.

import { civilDateAtOffset } from "@/lib/google/exercise-normalizers";
import { formatInstantWithOffset } from "@/lib/api/time";

// ── Recording method ───────────────────────────────────────────────────────

/**
 * Google's `dataSource.recordingMethod` as stored, mapped to a stable discriminant:
 *  - PASSIVELY_MEASURED -> auto_detected (the watch noticed the activity; the person did not start it)
 *  - ACTIVELY_MEASURED  -> tracked       (the person started a workout on the device)
 *  - MANUAL             -> manual        (typed in; no sensor data)
 * Any other value keeps its raw string under `unknown` instead of being guessed.
 */
export type WorkoutRecordingMethod =
  | { kind: "auto_detected"; raw: string }
  | { kind: "tracked"; raw: string }
  | { kind: "manual"; raw: string }
  | { kind: "unknown"; raw: string };

export function mapRecordingMethod(raw: string): WorkoutRecordingMethod {
  switch (raw) {
    case "PASSIVELY_MEASURED":
      return { kind: "auto_detected", raw };
    case "ACTIVELY_MEASURED":
      return { kind: "tracked", raw };
    case "MANUAL":
      return { kind: "manual", raw };
    default:
      return { kind: "unknown", raw };
  }
}

/** "STRENGTH_TRAINING" -> "Strength training". */
export function exerciseTypeLabel(type: string): string {
  const words = type.toLowerCase().split("_").filter((w) => w.length > 0).join(" ");
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : type;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkoutHrSample {
  /** Epoch ms. */
  tMs: number;
  bpm: number;
}

export interface WorkoutInput {
  id: string;
  /** Stored local start date "YYYY-MM-DD". */
  exerciseDate: string;
  exerciseType: string;
  displayName: string | null;
  startMs: number;
  endMs: number;
  startUtcOffsetSeconds: number;
  endUtcOffsetSeconds: number | null;
  activeDurationSeconds: number;
  caloriesKcal: number | null;
  distanceMeters: number | null;
  /** Google's own session average, null when absent. */
  avgHeartRateBpm: number | null;
  lightZoneSeconds: number | null;
  moderateZoneSeconds: number | null;
  vigorousZoneSeconds: number | null;
  peakZoneSeconds: number | null;
  recordingMethod: string;
  /** Stored heart-rate samples for this workout's window (any order; the engine keeps those inside it). */
  hrSamples: WorkoutHrSample[];
}

export interface WorkoutZoneMinutes {
  /** Minutes in Google's Karvonen zone (same naming caveat as heartZoneMinutes). Null when Google omitted it. */
  light: number | null;
  moderate: number | null;
  vigorous: number | null;
  peak: number | null;
}

export interface WorkoutHrStats {
  min: number;
  avg: number;
  max: number;
  sampleCount: number;
}

interface WorkoutBase {
  id: string;
  /** Local start date; also the date the session is listed under. */
  date: string;
  type: string;
  name: string;
  /** ISO 8601 with the UTC offset in force at that moment, e.g. 2026-07-14T18:05:00+01:00. */
  startLocal: string;
  endLocal: string;
  /** Local date of the end; differs from `date` when the workout crossed midnight. */
  endDate: string;
  crossesMidnight: boolean;
  /** end - start, in minutes (1 decimal). Includes pauses. */
  durationMinutes: number;
  /** Time actually exercising, in minutes (1 decimal). Shorter than durationMinutes when paused. */
  activeDurationMinutes: number;
  recordingMethod: WorkoutRecordingMethod;
  /** Google's own session figure. Null when absent. */
  caloriesKcal: number | null;
  /** Google's own average. Null when absent. */
  averageHeartRate: number | null;
  zoneMinutes: WorkoutZoneMinutes;
  /** Null when there is no distance (absent, or Google's 0 for a non-distance activity). */
  distanceMeters: number | null;
  /** Average speed over the ACTIVE duration. Null without distance. */
  speedKmh: number | null;
  /** Average pace over the ACTIVE duration, seconds per km. Null without distance. */
  paceSecondsPerKm: number | null;
}

export interface WorkoutWithHr extends WorkoutBase {
  hasHeartRateSamples: true;
  heartRate: WorkoutHrStats;
}

export interface WorkoutWithoutHr extends WorkoutBase {
  hasHeartRateSamples: false;
  heartRate: null;
}

export type Workout = WorkoutWithHr | WorkoutWithoutHr;

// ── Per-workout ────────────────────────────────────────────────────────────

const round1 = (n: number): number => Math.round(n * 10) / 10;
const secondsToMinutes = (s: number | null): number | null => (s === null ? null : round1(s / 60));

function hrStats(samples: WorkoutHrSample[], startMs: number, endMs: number): WorkoutHrStats | null {
  let n = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s.tMs < startMs || s.tMs > endMs) continue;
    n += 1;
    sum += s.bpm;
    if (s.bpm < min) min = s.bpm;
    if (s.bpm > max) max = s.bpm;
  }
  return n === 0 ? null : { min, avg: round1(sum / n), max, sampleCount: n };
}

export function buildWorkout(w: WorkoutInput): Workout {
  const endOffset = w.endUtcOffsetSeconds ?? w.startUtcOffsetSeconds;
  const endDate = civilDateAtOffset(w.endMs, endOffset);
  const hasDistance = w.distanceMeters !== null && w.distanceMeters > 0;
  const canPace = hasDistance && w.activeDurationSeconds > 0;
  const km = (hasDistance ? (w.distanceMeters ?? 0) : 0) / 1000;

  const base: WorkoutBase = {
    id: w.id,
    date: w.exerciseDate,
    type: w.exerciseType,
    name: w.displayName ?? exerciseTypeLabel(w.exerciseType),
    startLocal: formatInstantWithOffset(w.startMs, w.startUtcOffsetSeconds),
    endLocal: formatInstantWithOffset(w.endMs, endOffset),
    endDate,
    crossesMidnight: endDate !== w.exerciseDate,
    durationMinutes: round1((w.endMs - w.startMs) / 60_000),
    activeDurationMinutes: round1(w.activeDurationSeconds / 60),
    recordingMethod: mapRecordingMethod(w.recordingMethod),
    caloriesKcal: w.caloriesKcal,
    averageHeartRate: w.avgHeartRateBpm,
    zoneMinutes: {
      light: secondsToMinutes(w.lightZoneSeconds),
      moderate: secondsToMinutes(w.moderateZoneSeconds),
      vigorous: secondsToMinutes(w.vigorousZoneSeconds),
      peak: secondsToMinutes(w.peakZoneSeconds),
    },
    distanceMeters: hasDistance ? w.distanceMeters : null,
    speedKmh: canPace ? round1(km / (w.activeDurationSeconds / 3600)) : null,
    paceSecondsPerKm: canPace ? Math.round(w.activeDurationSeconds / km) : null,
  };

  const stats = hrStats(w.hrSamples, w.startMs, w.endMs);
  return stats === null
    ? { ...base, hasHeartRateSamples: false, heartRate: null }
    : { ...base, hasHeartRateSamples: true, heartRate: stats };
}

/** All sessions of one day, ascending by start; every session is kept, overlapping or not. */
export function buildWorkouts(inputs: WorkoutInput[]): Workout[] {
  return [...inputs].sort((a, b) => a.startMs - b.startMs).map(buildWorkout);
}

// ── Daily rollup ───────────────────────────────────────────────────────────

export interface DailyWorkoutRollup {
  workoutCount: number;
  /** Sum of active durations. Overlapping sessions are not deduplicated, so they add up. */
  activeMinutes: number;
  /** Sum of the sessions' OWN calories; null when there are sessions but none has a figure. 0 when no sessions. */
  workoutCaloriesKcal: number | null;
  /** Sessions with no calorie figure (they are left out of workoutCaloriesKcal, not counted as 0). */
  sessionsMissingCalories: number;
  /** workoutCaloriesKcal / total calories (0-1). Null when either is unknown or the total is 0. */
  shareOfTotalCalories: number | null;
}

export function rollupWorkouts(workouts: Workout[], totalCaloriesKcal: number | null): DailyWorkoutRollup {
  let active = 0;
  let kcal = 0;
  let withKcal = 0;
  for (const w of workouts) {
    active += w.activeDurationMinutes;
    if (w.caloriesKcal !== null) {
      kcal += w.caloriesKcal;
      withKcal += 1;
    }
  }
  const workoutCaloriesKcal = workouts.length === 0 ? 0 : withKcal === 0 ? null : round1(kcal);
  return {
    workoutCount: workouts.length,
    activeMinutes: round1(active),
    workoutCaloriesKcal,
    sessionsMissingCalories: workouts.length - withKcal,
    shareOfTotalCalories:
      workoutCaloriesKcal !== null && totalCaloriesKcal !== null && totalCaloriesKcal > 0
        ? Math.round((workoutCaloriesKcal / totalCaloriesKcal) * 1000) / 1000
        : null,
  };
}

// ── Coverage and daily energy ──────────────────────────────────────────────

export interface CoverageInput {
  date: string;
  /** sync_state.synced_through (null = not tracked). */
  syncedThrough: string | null;
  /**
   * First date the exercise slice (sessions + daily energy) was ever fetched, i.e. the earliest stored
   * daily_energy date or session date. Null when none is stored. Exercise was backfilled only from there,
   * so older dates can sit before the sync cursor and still never have been fetched.
   */
  coverageStart: string | null;
}

/** Whether the exercise slice has been synced for a date: inside [coverageStart, syncedThrough]. */
export function isExerciseSynced(c: CoverageInput): boolean {
  return c.syncedThrough !== null && c.coverageStart !== null && c.date >= c.coverageStart && c.date <= c.syncedThrough;
}

export type EnergyReason = "not_worn" | "not_synced" | "partial_day" | "not_supported";

export type EnergyFigure =
  | { status: "measured"; kcal: number; partialDay: boolean }
  | { status: "unavailable"; reason: EnergyReason };

export interface EnergyInput {
  date: string;
  today: string;
  /** Result of isExerciseSynced for this date. */
  synced: boolean;
  /** The daily_energy row's values; null when no row is stored. */
  totalCaloriesKcal: number | null;
  activeCaloriesKcal: number | null;
  /** A heart_rate_summaries row or any heart_rate_samples exist for the date. */
  hasWearEvidence: boolean;
}

export interface DailyEnergyResult {
  total: EnergyFigure;
  active: EnergyFigure;
}

/**
 * Honest daily energy. Where active calories are null AND there is no wear evidence, Google's total is a
 * resting-only fill (e.g. 2026-10-10..13, all 1488.3264), so it is `not_worn`, not measured. Null active
 * calories WITH wear evidence leave the total measured, and the active figure is `not_supported` (Google
 * returned none for that day, e.g. before 2026-05-08), not `not_worn`. Today stays measured with
 * `partialDay`. An unsynced day is `not_synced` for both.
 */
export function classifyDailyEnergy(e: EnergyInput): DailyEnergyResult {
  const isToday = e.date === e.today;
  if (!e.synced && !isToday) {
    return { total: { status: "unavailable", reason: "not_synced" }, active: { status: "unavailable", reason: "not_synced" } };
  }
  const missing = (reason: EnergyReason): EnergyFigure => ({ status: "unavailable", reason });
  const figure = (kcal: number | null, reason: EnergyReason): EnergyFigure =>
    kcal === null ? missing(reason) : { status: "measured", kcal, partialDay: isToday };

  const absent: EnergyReason = isToday ? "partial_day" : "not_worn";
  const restingOnlyFill = e.activeCaloriesKcal === null && !e.hasWearEvidence && !isToday && e.totalCaloriesKcal !== null;
  return {
    total: restingOnlyFill ? missing("not_worn") : figure(e.totalCaloriesKcal, absent),
    active: figure(e.activeCaloriesKcal, isToday ? "partial_day" : e.hasWearEvidence ? "not_supported" : "not_worn"),
  };
}
