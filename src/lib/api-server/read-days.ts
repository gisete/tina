// DB-only loaders for the /api/v1 read endpoints. No Google calls and no writes:
// intra-night HR samples are read from the cache table and never fetched.
// Scores come from the same assembleDashboardData the dashboard uses.

import { and, asc, desc, eq, gte, lt, lte, min, or } from "drizzle-orm";
import { db } from "@/db/client";
import { dailyActivitySummaries, dailyEnergy, exerciseSessions, heartRateSamples, heartRateSummaries, sleepSessions, syncState } from "@/db/schema";
import { assembleDashboardData, type SleepSessionRow } from "@/lib/sync/assemble";
import { resolveSelectedNight, selectMainSessions } from "@/lib/analytics/sleep";
import { addDays, localToday, parseLocalDate } from "@/lib/dates";
import type { WorkoutInput } from "@/lib/analytics/exercise";
import { buildDayData, enumerateDates, rowsBeforeDay, type DayData, type SessionInput } from "@/lib/api";

/** Mirrors readDashboardData's limits so a day's score matches the dashboard's. */
const SESSION_LIMIT = 90;
const HEART_LIMIT = 45;

function toSessionInput(r: SleepSessionRow): SessionInput {
  return {
    sleepDate: r.sleepDate,
    startMs: r.startTime.getTime(),
    endMs: r.endTime.getTime(),
    startUtcOffsetSeconds: r.startUtcOffsetSeconds ?? null,
    endUtcOffsetSeconds: r.endUtcOffsetSeconds ?? null,
    totalSleepMs: r.totalSleepMs,
    efficiencyScore: r.efficiencyScore,
    stages: r.stages.map((s) => ({
      stageType: s.stageType,
      startMs: s.startTime.getTime(),
      endMs: s.endTime.getTime(),
      durationMs: s.durationMs,
    })),
  };
}

type ExerciseSessionRow = typeof exerciseSessions.$inferSelect;

function toWorkoutInput(r: ExerciseSessionRow, samples: Array<{ tMs: number; bpm: number }>): WorkoutInput {
  const startMs = r.startTime.getTime();
  const endMs = r.endTime.getTime();
  return {
    id: r.id,
    exerciseDate: r.exerciseDate,
    exerciseType: r.exerciseType,
    displayName: r.displayName,
    startMs,
    endMs,
    startUtcOffsetSeconds: r.startUtcOffsetSeconds,
    endUtcOffsetSeconds: r.endUtcOffsetSeconds,
    activeDurationSeconds: r.activeDurationSeconds,
    caloriesKcal: r.caloriesKcal,
    distanceMeters: r.distanceMeters,
    avgHeartRateBpm: r.avgHeartRateBpm,
    lightZoneSeconds: r.lightZoneSeconds,
    moderateZoneSeconds: r.moderateZoneSeconds,
    vigorousZoneSeconds: r.vigorousZoneSeconds,
    peakZoneSeconds: r.peakZoneSeconds,
    recordingMethod: r.recordingMethod,
    hrSamples: samples.filter((p) => p.tMs >= startMs && p.tMs <= endMs),
  };
}

export async function loadDays(userId: string, from: string, to: string): Promise<DayData[]> {
  const today = localToday();
  const dates = enumerateDates(from, to);

  const [beforeRange, inRange, heartRows, activityRows, syncRow, sessionRows, energyRows, energyStart, sessionStart] = await Promise.all([
    // Exactly the dashboard's window for the first day: the 90 newest rows before it.
    db.query.sleepSessions.findMany({
      where: and(eq(sleepSessions.userId, userId), lt(sleepSessions.sleepDate, from)),
      orderBy: [desc(sleepSessions.sleepDate)],
      limit: SESSION_LIMIT,
      with: { stages: true },
    }),
    // Every row inside the range (no limit), so each later day's window is reproduced exactly (rowsBeforeDay).
    db.query.sleepSessions.findMany({
      where: and(eq(sleepSessions.userId, userId), gte(sleepSessions.sleepDate, from), lt(sleepSessions.sleepDate, to)),
      orderBy: [desc(sleepSessions.sleepDate)],
      with: { stages: true },
    }),
    // heart_rate_summaries is unique per (user, date): HEART_LIMIT + one row per requested day is exact.
    db.query.heartRateSummaries.findMany({
      where: and(eq(heartRateSummaries.userId, userId), lte(heartRateSummaries.date, to)),
      orderBy: [desc(heartRateSummaries.date)],
      limit: HEART_LIMIT + dates.length,
    }),
    db.query.dailyActivitySummaries.findMany({
      where: and(
        eq(dailyActivitySummaries.userId, userId),
        gte(dailyActivitySummaries.activityDate, from),
        lte(dailyActivitySummaries.activityDate, to),
      ),
    }),
    db.query.syncState.findFirst({ where: eq(syncState.userId, userId) }),
    // Workouts listed under the local date of their start (exercise_date), and the day's energy row. DB only.
    db.query.exerciseSessions.findMany({
      where: and(eq(exerciseSessions.userId, userId), gte(exerciseSessions.exerciseDate, from), lte(exerciseSessions.exerciseDate, to)),
      orderBy: [asc(exerciseSessions.startTime)],
    }),
    db.query.dailyEnergy.findMany({
      where: and(eq(dailyEnergy.userId, userId), gte(dailyEnergy.energyDate, from), lte(dailyEnergy.energyDate, to)),
    }),
    // When the exercise slice was first fetched: older days were never synced for exercise, whatever the cursor says.
    db.select({ d: min(dailyEnergy.energyDate) }).from(dailyEnergy).where(eq(dailyEnergy.userId, userId)),
    db.select({ d: min(exerciseSessions.exerciseDate) }).from(exerciseSessions).where(eq(exerciseSessions.userId, userId)),
  ]);

  // The night each day displays: the newest main session before it (nightOf = day − 1 when recorded).
  const windows = new Map<string, SleepSessionRow[]>(dates.map((d) => [d, rowsBeforeDay<SleepSessionRow>(beforeRange, inRange, d, SESSION_LIMIT)]));
  const displayed = new Map<string, SleepSessionRow>();
  for (const rows of windows.values()) {
    const night = selectMainSessions(rows)[0];
    if (night) displayed.set(`${night.startTime.getTime()}`, night);
  }

  // Stored HR samples for exactly those nights (cache only, never fetched); one range clause per night.
  const nightClauses = [...displayed.values()].map((n) =>
    and(gte(heartRateSamples.timestamp, n.startTime), lte(heartRateSamples.timestamp, n.endTime)),
  );
  const sampleRows =
    nightClauses.length > 0
      ? await db.query.heartRateSamples.findMany({
          where: and(eq(heartRateSamples.userId, userId), or(...nightClauses)),
          orderBy: [asc(heartRateSamples.timestamp)],
        })
      : [];

  // Stored HR samples inside each workout window (cache only, never fetched).
  const workoutClauses = sessionRows.map((r) => and(gte(heartRateSamples.timestamp, r.startTime), lte(heartRateSamples.timestamp, r.endTime)));
  const workoutSampleRows =
    workoutClauses.length > 0
      ? await db
          .select({ timestamp: heartRateSamples.timestamp, bpm: heartRateSamples.bpm })
          .from(heartRateSamples)
          .where(and(eq(heartRateSamples.userId, userId), or(...workoutClauses)))
          .orderBy(asc(heartRateSamples.timestamp))
      : [];
  const workoutSamples = workoutSampleRows.map((p) => ({ tMs: p.timestamp.getTime(), bpm: p.bpm }));
  const sessionsByDate = new Map<string, WorkoutInput[]>();
  for (const r of sessionRows) {
    const list = sessionsByDate.get(r.exerciseDate) ?? [];
    list.push(toWorkoutInput(r, workoutSamples));
    sessionsByDate.set(r.exerciseDate, list);
  }
  const energyByDate = new Map(energyRows.map((r) => [r.energyDate, r]));
  const coverageStart = [energyStart[0]?.d ?? null, sessionStart[0]?.d ?? null].filter((d): d is string => d !== null).sort()[0] ?? null;

  // Wear evidence only matters where active calories are null or the energy row is missing (the resting-only-fill
  // rule): a heart summary row or any stored HR sample that local day. Today is skipped (the engine ignores it).
  // Checked one day at a time (an indexed LIMIT 1 each, at most MAX_RANGE_DAYS), so the pool is never flooded.
  const heartDates = new Set(heartRows.map((r) => r.date));
  const needEvidence = dates.filter((d) => d !== today && !heartDates.has(d) && (energyByDate.get(d)?.activeCaloriesKcal ?? null) === null);
  const sampleDays = new Set<string>();
  for (const d of needEvidence) {
    const rows = await db
      .select({ id: heartRateSamples.id })
      .from(heartRateSamples)
      .where(and(eq(heartRateSamples.userId, userId), gte(heartRateSamples.timestamp, parseLocalDate(d)), lt(heartRateSamples.timestamp, parseLocalDate(addDays(d, 1)))))
      .limit(1);
    if (rows.length > 0) sampleDays.add(d);
  }

  const syncedThrough = syncRow?.syncedThrough ?? null;
  const activityByDate = new Map(activityRows.map((r) => [r.activityDate, r]));
  const heartByDate = new Map(heartRows.map((r) => [r.date, r]));

  return dates.map((date) => {
    // Same inputs the dashboard gets for ?date=: 90 most recent rows before the day, 45 heart rows up to it.
    const rowsBefore = windows.get(date) ?? [];
    const heartUpTo = heartRows.filter((r) => r.date <= date).slice(0, HEART_LIMIT);

    const displayed = selectMainSessions(rowsBefore)[0];
    const samples = displayed
      ? sampleRows.filter((p) => p.timestamp >= displayed.startTime && p.timestamp <= displayed.endTime)
      : [];

    const assembled = assembleDashboardData(
      rowsBefore,
      heartUpTo.map((r) => ({ date: r.date, restingHeartRate: r.restingHeartRate, hrvRmssd: r.hrvRmssd })),
      samples.map((p) => ({ timestamp: p.timestamp, bpm: p.bpm })),
      8,
    );

    const resolved = resolveSelectedNight({ sessions: rowsBefore, selectedDate: date, today });
    const nightOf = resolved.status === "recorded" ? resolved.nightOf : null;
    const nightSessions = nightOf ? rowsBefore.filter((s) => s.sleepDate === nightOf).map(toSessionInput) : [];
    const impliedNight = assembled.hasData && assembled.lastNight?.sleepDate === nightOf;

    const heartRow = heartByDate.get(date);
    const activity = activityByDate.get(date);
    return buildDayData({
      date,
      today,
      syncedThrough,
      nightSessions,
      lastNight: impliedNight && assembled.hasData ? assembled.lastNight : null,
      nightHeart: impliedNight && assembled.hasData ? assembled.nightHeart : null,
      cardiacStrain: impliedNight && assembled.hasData ? assembled.cardiacStrain : null,
      hasNightSamples: samples.length > 0,
      restingHeartRate: heartRow?.restingHeartRate ?? null,
      hrv: heartRow?.hrvRmssd ?? null,
      activity: activity
        ? {
            steps: activity.steps,
            light: activity.lightMinutes,
            moderate: activity.moderateMinutes,
            vigorous: activity.vigorousMinutes,
            peak: activity.peakMinutes,
          }
        : null,
      exercise: {
        sessions: sessionsByDate.get(date) ?? [],
        coverageStart,
        totalCaloriesKcal: energyByDate.get(date)?.totalCaloriesKcal ?? null,
        activeCaloriesKcal: energyByDate.get(date)?.activeCaloriesKcal ?? null,
        hasWearEvidence: heartDates.has(date) || sampleDays.has(date),
      },
    });
  });
}
