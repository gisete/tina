// Read-only DB queries for the Today plan. Parallel to persist.ts for writes.
// Takes userId as a plain parameter — callers handle auth first.

import { db } from "@/db/client";
import { exercisePlanItems, mealPlanItems, conditions, conditionOptions, mindsetItems, motivationLines } from "@/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import type { IsoWeekday, PlanData } from "./types";

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
