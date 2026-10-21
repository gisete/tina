"use server";

// Today-screen logging actions. Orchestration only: auth → validate (incl. the
// today/yesterday window) → read → pure builder → persist → revalidate.
// Builders live in src/lib/today, writes in src/lib/today/persist.ts.

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { localToday } from "@/lib/dates";
import {
  buildBackupLog,
  isoWeekdayOf,
  plannedItemsFor,
  skippedExerciseLog,
  toggleExerciseItem,
  validateBoolean,
  validateId,
  validateIdList,
  validateLogDate,
} from "@/lib/today";
import { readCondition, readExerciseLog, readPlan } from "@/lib/today/read";
import * as log from "@/lib/today/persist";

export type TodayResult = { ok: true } | { ok: false; error: string };

const TODAY_PATH = "/dashboard/today";

/** Auth gate + date-window check + revalidation shared by every action. */
async function mutate(
  rawDate: unknown,
  run: (userId: string, date: string) => Promise<TodayResult>,
): Promise<TodayResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthenticated" };

  const date = validateLogDate(rawDate, localToday());
  if (!date.ok) return date;

  try {
    const result = await run(session.user.id, date.value);
    if (result.ok) revalidatePath(TODAY_PATH);
    return result;
  } catch (err) {
    console.error("[today]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Something went wrong saving that" };
  }
}

const OK: TodayResult = { ok: true };

/** Checks a workout item off/on. The first check snapshots the weekday's plan. */
export async function toggleWorkoutItem(date: string, index: number): Promise<TodayResult> {
  return mutate(date, async (userId, d) => {
    if (!Number.isInteger(index)) return { ok: false, error: "Invalid item" };
    const [existing, plan] = await Promise.all([readExerciseLog(userId, d), readPlan(userId)]);
    const next = toggleExerciseItem(existing, plannedItemsFor(d, plan.exercise), index);
    if (!next) return { ok: false, error: "Nothing to check off" };
    await log.upsertExerciseLog(userId, d, next);
    return OK;
  });
}

/** Logs the chosen backup options for a condition (snapshotted by name). */
export async function logBackupWorkout(date: string, conditionId: number, optionIds: number[]): Promise<TodayResult> {
  return mutate(date, async (userId, d) => {
    const id = validateId(conditionId);
    if (!id.ok) return id;
    const ids = validateIdList(optionIds);
    if (!ids.ok) return ids;

    const condition = await readCondition(userId, id.value);
    if (!condition) return { ok: false, error: "Condition not found" };
    const built = buildBackupLog(condition, condition.options, ids.value);
    if (!built.ok) return built;
    await log.upsertExerciseLog(userId, d, built.value);
    return OK;
  });
}

export async function skipWorkout(date: string): Promise<TodayResult> {
  return mutate(date, async (userId, d) => {
    await log.upsertExerciseLog(userId, d, skippedExerciseLog());
    return OK;
  });
}

/** Clears the day's exercise log, returning it to the unlogged plan. */
export async function resetWorkout(date: string): Promise<TodayResult> {
  return mutate(date, async (userId, d) => {
    await log.deleteExerciseLog(userId, d);
    return OK;
  });
}

/**
 * Checks a meal on/off. Pass `mealPlanItemId` for a template meal, or `logId`
 * for a detached log whose template item no longer exists.
 */
export async function setMealChecked(input: {
  date: string;
  mealPlanItemId?: number | null;
  logId?: number | null;
  followed: boolean;
}): Promise<TodayResult> {
  return mutate(input?.date, async (userId, d) => {
    const followed = validateBoolean(input.followed);
    if (!followed.ok) return followed;

    if (input.logId != null) {
      const logId = validateId(input.logId);
      if (!logId.ok) return logId;
      const found = await log.setMealLogFollowed(userId, d, logId.value, followed.value);
      return found ? OK : { ok: false, error: "Meal not found" };
    }

    const itemId = validateId(input.mealPlanItemId);
    if (!itemId.ok) return itemId;
    const found = await log.setMealFollowed(userId, d, isoWeekdayOf(d), itemId.value, followed.value);
    return found ? OK : { ok: false, error: "Meal not found for that day" };
  });
}
