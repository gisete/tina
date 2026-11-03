// DB-only loaders for the /api/v1 read endpoints. No Google calls and no writes:
// intra-night HR samples are read from the cache table and never fetched.
// Scores come from the same assembleDashboardData the dashboard uses.

import { and, asc, desc, eq, gte, lt, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { dailyActivitySummaries, heartRateSamples, heartRateSummaries, sleepSessions, syncState } from "@/db/schema";
import { assembleDashboardData, type SleepSessionRow } from "@/lib/sync/assemble";
import { resolveSelectedNight, selectMainSessions } from "@/lib/analytics/sleep";
import { localToday } from "@/lib/dates";
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

export async function loadDays(userId: string, from: string, to: string): Promise<DayData[]> {
  const today = localToday();
  const dates = enumerateDates(from, to);

  const [beforeRange, inRange, heartRows, activityRows, syncRow] = await Promise.all([
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
    });
  });
}
