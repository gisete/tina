// Database writes for the Today plan editor. Callers (Server Actions) handle
// auth and validation first and hand in a plain userId plus validated values.
// Every statement is scoped by user_id so one user can never touch another's
// rows, even with a guessed id.
//
// Conditions and their options are archived, never deleted: exercise_day_logs
// reference conditions, and their snapshots must stay explainable.

import { db } from "@/db/client";
import {
  exercisePlanItems,
  mealPlanItems,
  conditions,
  conditionOptions,
  mindsetItems,
  motivationLines,
  exerciseDayLogs,
  mealLogs,
} from "@/db/schema";
import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import { moveId, type MoveDirection } from "./validate";
import type { ExerciseDayLog, IsoWeekday, MealSlot, MindsetKind } from "./types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Next free position (max + 1) for rows matching `scope`. */
async function nextPosition(
  tx: Tx,
  table: typeof exercisePlanItems | typeof mealPlanItems | typeof conditions | typeof conditionOptions | typeof mindsetItems,
  scope: SQL | undefined,
): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number | null>`max(${table.position})` })
    .from(table)
    .where(scope);
  return (row?.max ?? -1) + 1;
}

/** Re-numbers a scope after moving one id up/down. */
async function moveWithin(
  tx: Tx,
  table: typeof exercisePlanItems | typeof mealPlanItems | typeof conditions | typeof conditionOptions | typeof mindsetItems,
  scope: SQL | undefined,
  id: number,
  direction: MoveDirection,
): Promise<void> {
  const rows = await tx
    .select({ id: table.id })
    .from(table)
    .where(scope)
    .orderBy(asc(table.position), asc(table.id));
  const ordered = moveId(rows.map((r) => r.id), id, direction);
  for (let i = 0; i < ordered.length; i++) {
    await tx.update(table).set({ position: i }).where(and(scope, eq(table.id, ordered[i])));
  }
}

// ── Exercise plan ────────────────────────────────────────────────────────────

export async function insertExerciseItem(
  userId: string,
  v: { weekday: IsoWeekday; name: string; details: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const position = await nextPosition(
      tx, exercisePlanItems,
      and(eq(exercisePlanItems.userId, userId), eq(exercisePlanItems.weekday, v.weekday)),
    );
    await tx.insert(exercisePlanItems).values({ userId, ...v, position });
  });
}

export async function updateExerciseItem(
  userId: string,
  id: number,
  v: { name: string; details: string | null },
): Promise<void> {
  await db
    .update(exercisePlanItems)
    .set({ ...v, updatedAt: sql`NOW()` })
    .where(and(eq(exercisePlanItems.id, id), eq(exercisePlanItems.userId, userId)));
}

export async function deleteExerciseItem(userId: string, id: number): Promise<void> {
  await db
    .delete(exercisePlanItems)
    .where(and(eq(exercisePlanItems.id, id), eq(exercisePlanItems.userId, userId)));
}

export async function moveExerciseItem(userId: string, id: number, direction: MoveDirection): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ weekday: exercisePlanItems.weekday })
      .from(exercisePlanItems)
      .where(and(eq(exercisePlanItems.id, id), eq(exercisePlanItems.userId, userId)));
    if (!item) return;
    await moveWithin(
      tx, exercisePlanItems,
      and(eq(exercisePlanItems.userId, userId), eq(exercisePlanItems.weekday, item.weekday)),
      id, direction,
    );
  });
}

// ── Meal plan ────────────────────────────────────────────────────────────────

export async function insertMealItem(
  userId: string,
  v: { weekday: IsoWeekday; slot: MealSlot; description: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const position = await nextPosition(
      tx, mealPlanItems,
      and(eq(mealPlanItems.userId, userId), eq(mealPlanItems.weekday, v.weekday), eq(mealPlanItems.slot, v.slot)),
    );
    await tx.insert(mealPlanItems).values({ userId, ...v, position });
  });
}

export async function updateMealItem(userId: string, id: number, description: string): Promise<void> {
  await db
    .update(mealPlanItems)
    .set({ description, updatedAt: sql`NOW()` })
    .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)));
}

export async function deleteMealItem(userId: string, id: number): Promise<void> {
  await db
    .delete(mealPlanItems)
    .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)));
}

export async function moveMealItem(userId: string, id: number, direction: MoveDirection): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ weekday: mealPlanItems.weekday, slot: mealPlanItems.slot })
      .from(mealPlanItems)
      .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)));
    if (!item) return;
    await moveWithin(
      tx, mealPlanItems,
      and(eq(mealPlanItems.userId, userId), eq(mealPlanItems.weekday, item.weekday), eq(mealPlanItems.slot, item.slot)),
      id, direction,
    );
  });
}

/**
 * Replaces every other weekday's meals with a copy of `weekday`'s meals.
 * Past meal_logs keep their description snapshots (FK is set null on delete).
 * Resolves false, touching nothing, when the source day has no meals — an
 * empty source must never wipe the rest of the week.
 */
export async function copyMealDayToAllDays(userId: string, weekday: IsoWeekday): Promise<boolean> {
  return db.transaction(async (tx) => {
    const source = await tx
      .select()
      .from(mealPlanItems)
      .where(and(eq(mealPlanItems.userId, userId), eq(mealPlanItems.weekday, weekday)))
      .orderBy(asc(mealPlanItems.position), asc(mealPlanItems.id));
    if (source.length === 0) return false;

    await tx
      .delete(mealPlanItems)
      .where(and(eq(mealPlanItems.userId, userId), ne(mealPlanItems.weekday, weekday)));

    const copies = ([1, 2, 3, 4, 5, 6, 7] as const)
      .filter((d) => d !== weekday)
      .flatMap((d) =>
        source.map((s) => ({ userId, weekday: d, slot: s.slot, position: s.position, description: s.description })),
      );
    await tx.insert(mealPlanItems).values(copies);
    return true;
  });
}

// ── Conditions & options (archive, never delete) ─────────────────────────────

export async function insertCondition(
  userId: string,
  v: { name: string; sleepScoreBelow: number | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const position = await nextPosition(tx, conditions, eq(conditions.userId, userId));
    await tx.insert(conditions).values({ userId, ...v, position });
  });
}

export async function updateCondition(
  userId: string,
  id: number,
  v: { name: string; sleepScoreBelow: number | null },
): Promise<void> {
  await db.update(conditions).set(v).where(and(eq(conditions.id, id), eq(conditions.userId, userId)));
}

export async function setConditionArchived(userId: string, id: number, archived: boolean): Promise<void> {
  await db.update(conditions).set({ archived }).where(and(eq(conditions.id, id), eq(conditions.userId, userId)));
}

/** Resolves true when the condition exists and belongs to the user. */
async function ownsCondition(tx: Tx | typeof db, userId: string, conditionId: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: conditions.id })
    .from(conditions)
    .where(and(eq(conditions.id, conditionId), eq(conditions.userId, userId)));
  return row !== undefined;
}

export async function insertConditionOption(
  userId: string,
  v: { conditionId: number; name: string; details: string | null },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await ownsCondition(tx, userId, v.conditionId))) return false;
    const position = await nextPosition(tx, conditionOptions, eq(conditionOptions.conditionId, v.conditionId));
    await tx.insert(conditionOptions).values({ ...v, position });
    return true;
  });
}

/** Option ids are only reachable through a condition the user owns. */
async function ownedOptionIds(userId: string, optionId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: conditionOptions.id })
    .from(conditionOptions)
    .innerJoin(conditions, eq(conditions.id, conditionOptions.conditionId))
    .where(and(eq(conditionOptions.id, optionId), eq(conditions.userId, userId)));
  return row?.id ?? null;
}

export async function updateConditionOption(
  userId: string,
  id: number,
  v: { name: string; details: string | null },
): Promise<void> {
  if ((await ownedOptionIds(userId, id)) === null) return;
  await db.update(conditionOptions).set(v).where(eq(conditionOptions.id, id));
}

export async function setConditionOptionArchived(userId: string, id: number, archived: boolean): Promise<void> {
  if ((await ownedOptionIds(userId, id)) === null) return;
  await db.update(conditionOptions).set({ archived }).where(eq(conditionOptions.id, id));
}

// ── Mantras & strategies ─────────────────────────────────────────────────────

export async function insertMindsetItem(userId: string, v: { kind: MindsetKind; text: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const position = await nextPosition(
      tx, mindsetItems,
      and(eq(mindsetItems.userId, userId), eq(mindsetItems.kind, v.kind)),
    );
    await tx.insert(mindsetItems).values({ userId, ...v, position });
  });
}

export async function updateMindsetItem(userId: string, id: number, text: string): Promise<void> {
  await db.update(mindsetItems).set({ text }).where(and(eq(mindsetItems.id, id), eq(mindsetItems.userId, userId)));
}

export async function deleteMindsetItem(userId: string, id: number): Promise<void> {
  await db.delete(mindsetItems).where(and(eq(mindsetItems.id, id), eq(mindsetItems.userId, userId)));
}

export async function moveMindsetItem(userId: string, id: number, direction: MoveDirection): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ kind: mindsetItems.kind })
      .from(mindsetItems)
      .where(and(eq(mindsetItems.id, id), eq(mindsetItems.userId, userId)));
    if (!item) return;
    await moveWithin(
      tx, mindsetItems,
      and(eq(mindsetItems.userId, userId), eq(mindsetItems.kind, item.kind)),
      id, direction,
    );
  });
}

// ── Motivation lines ─────────────────────────────────────────────────────────

export async function insertMotivationLine(userId: string, text: string): Promise<void> {
  await db.insert(motivationLines).values({ userId, text, active: true });
}

export async function updateMotivationLine(userId: string, id: number, text: string): Promise<void> {
  await db.update(motivationLines).set({ text }).where(and(eq(motivationLines.id, id), eq(motivationLines.userId, userId)));
}

export async function setMotivationLineActive(userId: string, id: number, active: boolean): Promise<void> {
  await db.update(motivationLines).set({ active }).where(and(eq(motivationLines.id, id), eq(motivationLines.userId, userId)));
}

export async function deleteMotivationLine(userId: string, id: number): Promise<void> {
  await db.delete(motivationLines).where(and(eq(motivationLines.id, id), eq(motivationLines.userId, userId)));
}

// ── Daily logs (snapshots) ───────────────────────────────────────────────────

/** Creates or replaces the single exercise log for (user, date). */
export async function upsertExerciseLog(userId: string, date: string, log: ExerciseDayLog): Promise<void> {
  const values = {
    status: log.status,
    conditionId: log.conditionId,
    conditionNameSnapshot: log.conditionNameSnapshot,
    items: log.items,
    note: log.note,
  };
  await db
    .insert(exerciseDayLogs)
    .values({ userId, date, ...values })
    .onConflictDoUpdate({
      target: [exerciseDayLogs.userId, exerciseDayLogs.date],
      set: { ...values, updatedAt: sql`NOW()` },
    });
}

export async function deleteExerciseLog(userId: string, date: string): Promise<void> {
  await db.delete(exerciseDayLogs).where(and(eq(exerciseDayLogs.userId, userId), eq(exerciseDayLogs.date, date)));
}

/**
 * Checks a template meal off (or on) for a date. The description is
 * snapshotted when the log row is first created and never rewritten, so later
 * template edits can't change what was logged. `weekday` must be the weekday
 * of `date`; a template item from another day resolves false.
 *
 * meal_logs' unique index treats NULL item ids as distinct, so an orphaned
 * log (FK nulled when the template item was recreated) with the same slot and
 * text is re-attached instead of inserting a duplicate row.
 */
export async function setMealFollowed(
  userId: string,
  date: string,
  weekday: IsoWeekday,
  mealPlanItemId: number,
  followed: boolean,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(mealPlanItems)
      .where(and(
        eq(mealPlanItems.id, mealPlanItemId),
        eq(mealPlanItems.userId, userId),
        eq(mealPlanItems.weekday, weekday),
      ));
    if (!item) return false;

    // Already logged against this item: just flip it. (Adopting an orphan here
    // would collide with the (user, date, item) unique index.)
    const [linked] = await tx
      .select({ id: mealLogs.id })
      .from(mealLogs)
      .where(and(eq(mealLogs.userId, userId), eq(mealLogs.date, date), eq(mealLogs.mealPlanItemId, item.id)));
    if (linked) {
      await tx.update(mealLogs).set({ followed, updatedAt: sql`NOW()` }).where(eq(mealLogs.id, linked.id));
      return true;
    }

    const [orphan] = await tx
      .select({ id: mealLogs.id })
      .from(mealLogs)
      .where(and(
        eq(mealLogs.userId, userId),
        eq(mealLogs.date, date),
        sql`${mealLogs.mealPlanItemId} IS NULL`,
        eq(mealLogs.slot, item.slot),
        eq(mealLogs.descriptionSnapshot, item.description),
      ))
      .limit(1);

    if (orphan) {
      await tx
        .update(mealLogs)
        .set({ mealPlanItemId: item.id, followed, updatedAt: sql`NOW()` })
        .where(eq(mealLogs.id, orphan.id));
      return true;
    }

    await tx
      .insert(mealLogs)
      .values({ userId, date, mealPlanItemId: item.id, slot: item.slot, descriptionSnapshot: item.description, followed })
      .onConflictDoUpdate({
        target: [mealLogs.userId, mealLogs.date, mealLogs.mealPlanItemId],
        set: { followed, updatedAt: sql`NOW()` },
      });
    return true;
  });
}

/** Toggles an existing meal log row directly (detached logs have no template item). */
export async function setMealLogFollowed(
  userId: string,
  date: string,
  logId: number,
  followed: boolean,
): Promise<boolean> {
  const updated = await db
    .update(mealLogs)
    .set({ followed, updatedAt: sql`NOW()` })
    .where(and(eq(mealLogs.id, logId), eq(mealLogs.userId, userId), eq(mealLogs.date, date)))
    .returning({ id: mealLogs.id });
  return updated.length > 0;
}
