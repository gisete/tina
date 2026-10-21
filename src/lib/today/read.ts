// Read-only DB queries for the Today plan. Parallel to persist.ts for writes.
// Takes userId as a plain parameter — callers handle auth first.

import { db } from "@/db/client";
import {
  exercisePlanItems, mealPlanItems, conditions, conditionOptions, mindsetItems, motivationLines,
  exerciseDayLogs, mealLogs, dailyActivitySummaries, sleepSessions, heartRateSummaries, heartRateSamples, syncState,
} from "@/db/schema";
import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { addDays } from "@/lib/dates";
import { selectMainSessions } from "@/lib/analytics/sleep";
import { assembleDashboardData } from "@/lib/sync/assemble";
import { MIN_CACHED_NIGHT_SAMPLES, summarizeLastNight, type LastNightScore } from "./last-night-score";
import type { ConditionOption, ConditionWithOptions, ExerciseDayLog, IsoWeekday, MealLog, PlanData } from "./types";

/** Loads the full plan (templates only — never logs) as plain data. */
export async function readPlan(userId: string): Promise<PlanData> {
  const [exercise, meals, conditionRows, mindset, motivation] = await Promise.all([
    db.select().from(exercisePlanItems).where(eq(exercisePlanItems.userId, userId))
      .orderBy(asc(exercisePlanItems.position), asc(exercisePlanItems.id)),
    db.select().from(mealPlanItems).where(eq(mealPlanItems.userId, userId))
      .orderBy(asc(mealPlanItems.position), asc(mealPlanItems.id)),
    db.select().from(conditions).where(eq(conditions.userId, userId))
      .orderBy(asc(conditions.position), asc(conditions.id)),
    db.select().from(mindsetItems).where(eq(mindsetItems.userId, userId))
      .orderBy(asc(mindsetItems.position), asc(mindsetItems.id)),
    db.select().from(motivationLines).where(eq(motivationLines.userId, userId))
      .orderBy(asc(motivationLines.id)),
  ]);

  const optionRows = conditionRows.length === 0
    ? []
    : await db.select().from(conditionOptions)
        .where(inArray(conditionOptions.conditionId, conditionRows.map((c) => c.id)))
        .orderBy(asc(conditionOptions.position), asc(conditionOptions.id));

  return {
    exercise: exercise.map((r) => ({
      id: r.id, weekday: r.weekday as IsoWeekday, position: r.position, name: r.name, details: r.details,
    })),
    meals: meals.map((r) => ({
      id: r.id, weekday: r.weekday as IsoWeekday, slot: r.slot, position: r.position, description: r.description,
    })),
    conditions: conditionRows.map((c) => ({
      id: c.id, name: c.name, position: c.position, sleepScoreBelow: c.sleepScoreBelow, archived: c.archived,
      options: optionRows
        .filter((o) => o.conditionId === c.id)
        .map((o) => ({
          id: o.id, conditionId: o.conditionId, name: o.name, details: o.details, position: o.position, archived: o.archived,
        })),
    })),
    mindset: mindset.map((r) => ({ id: r.id, kind: r.kind, text: r.text, position: r.position })),
    motivation: motivation.map((r) => ({ id: r.id, text: r.text, active: r.active })),
  };
}

// ── Today screen reads ───────────────────────────────────────────────────────

/** The exercise log for one local date, or null when nothing is logged. */
export async function readExerciseLog(userId: string, date: string): Promise<ExerciseDayLog | null> {
  const [row] = await db
    .select()
    .from(exerciseDayLogs)
    .where(and(eq(exerciseDayLogs.userId, userId), eq(exerciseDayLogs.date, date)));
  return row
    ? {
        status: row.status,
        conditionId: row.conditionId,
        conditionNameSnapshot: row.conditionNameSnapshot,
        items: row.items,
        note: row.note,
      }
    : null;
}

export async function readMealLogs(userId: string, date: string): Promise<MealLog[]> {
  const rows = await db
    .select()
    .from(mealLogs)
    .where(and(eq(mealLogs.userId, userId), eq(mealLogs.date, date)))
    .orderBy(asc(mealLogs.id));
  return rows.map((r) => ({
    id: r.id,
    mealPlanItemId: r.mealPlanItemId,
    slot: r.slot,
    descriptionSnapshot: r.descriptionSnapshot,
    followed: r.followed,
  }));
}

/** One condition with its options (archived included), or null if not the user's. */
export async function readCondition(userId: string, conditionId: number): Promise<ConditionWithOptions | null> {
  const [c] = await db
    .select()
    .from(conditions)
    .where(and(eq(conditions.id, conditionId), eq(conditions.userId, userId)));
  if (!c) return null;
  const opts = await db
    .select()
    .from(conditionOptions)
    .where(eq(conditionOptions.conditionId, c.id))
    .orderBy(asc(conditionOptions.position), asc(conditionOptions.id));
  const options: ConditionOption[] = opts.map((o) => ({
    id: o.id, conditionId: o.conditionId, name: o.name, details: o.details, position: o.position, archived: o.archived,
  }));
  return { id: c.id, name: c.name, position: c.position, sleepScoreBelow: c.sleepScoreBelow, archived: c.archived, options };
}

export interface StepsSummary {
  /** Null when no steps row exists for that day yet ("no data", not zero). */
  yesterday: number | null;
  today: number | null;
}

export async function readSteps(userId: string, today: string): Promise<StepsSummary> {
  const yesterday = addDays(today, -1);
  const rows = await db
    .select({ date: dailyActivitySummaries.activityDate, steps: dailyActivitySummaries.steps })
    .from(dailyActivitySummaries)
    .where(and(
      eq(dailyActivitySummaries.userId, userId),
      gte(dailyActivitySummaries.activityDate, yesterday),
      lte(dailyActivitySummaries.activityDate, today),
    ));
  const byDate = new Map(rows.map((r) => [r.date, r.steps]));
  return { yesterday: byDate.get(yesterday) ?? null, today: byDate.get(today) ?? null };
}

/** Sync clock as epoch ms, or null if the user has never synced. */
export async function readLastSyncedAtMs(userId: string): Promise<number | null> {
  const [row] = await db.select().from(syncState).where(eq(syncState.userId, userId));
  return row?.lastSyncedAt?.getTime() ?? null;
}

/**
 * Last night's sleep score from STORED data only. Deliberately does not go
 * through readDashboardData/ensureNightSamples: this path must never trigger
 * the lazy heart-rate fetch or any other Google call. Uncached intra-night
 * samples yield a partial score (cardiac = null).
 */
export async function readLastNightScore(userId: string, today: string): Promise<LastNightScore> {
  const [sessions, heartRows] = await Promise.all([
    db.query.sleepSessions.findMany({
      where: and(eq(sleepSessions.userId, userId), lt(sleepSessions.sleepDate, today)),
      orderBy: [desc(sleepSessions.sleepDate)],
      limit: 90,
      with: { stages: true },
    }),
    db.query.heartRateSummaries.findMany({
      where: and(eq(heartRateSummaries.userId, userId), lte(heartRateSummaries.date, today)),
      orderBy: [desc(heartRateSummaries.date)],
      limit: 45,
    }),
  ]);

  const displayed = selectMainSessions(sessions)[0];
  const samples = displayed
    ? await db.query.heartRateSamples.findMany({
        where: and(
          eq(heartRateSamples.userId, userId),
          gte(heartRateSamples.timestamp, displayed.startTime),
          lte(heartRateSamples.timestamp, displayed.endTime),
        ),
        orderBy: [asc(heartRateSamples.timestamp)],
      })
    : [];
  const cached = samples.length >= MIN_CACHED_NIGHT_SAMPLES ? samples : [];

  const data = assembleDashboardData(
    sessions,
    heartRows.map((r) => ({ date: r.date, restingHeartRate: r.restingHeartRate, hrvRmssd: r.hrvRmssd })),
    cached,
  );
  return summarizeLastNight(data, today, cached.length === 0);
}
