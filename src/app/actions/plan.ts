"use server";

// Plan-editor Server Actions. Orchestration only: auth → validate → persist →
// revalidate. Validation lives in src/lib/today/validate.ts, writes in
// src/lib/today/persist.ts.

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import {
  MAX_DETAILS_LENGTH,
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
  validateDirection,
  validateId,
  validateKind,
  validateOptionalText,
  validateSlot,
  validateText,
  validateThreshold,
  validateWeekday,
} from "@/lib/today/validate";
import * as plan from "@/lib/today/persist";

export type PlanResult = { ok: true } | { ok: false; error: string };

const PLAN_PATH = "/dashboard/plan";

/** Auth gate + revalidation shared by every action. */
async function mutate(run: (userId: string) => Promise<PlanResult>): Promise<PlanResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthenticated" };

  try {
    const result = await run(session.user.id);
    if (result.ok) revalidatePath(PLAN_PATH);
    return result;
  } catch (err) {
    console.error("[plan]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Something went wrong saving that" };
  }
}

const OK: PlanResult = { ok: true };

// ── Weekly workouts ──────────────────────────────────────────────────────────

export async function addExerciseItem(input: { weekday: number; name: string; details?: string | null }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const weekday = validateWeekday(input.weekday);
    if (!weekday.ok) return weekday;
    const name = validateText(input.name, "Name", MAX_NAME_LENGTH);
    if (!name.ok) return name;
    const details = validateOptionalText(input.details, "Details", MAX_DETAILS_LENGTH);
    if (!details.ok) return details;
    await plan.insertExerciseItem(userId, { weekday: weekday.value, name: name.value, details: details.value });
    return OK;
  });
}

export async function editExerciseItem(input: { id: number; name: string; details?: string | null }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const id = validateId(input.id);
    if (!id.ok) return id;
    const name = validateText(input.name, "Name", MAX_NAME_LENGTH);
    if (!name.ok) return name;
    const details = validateOptionalText(input.details, "Details", MAX_DETAILS_LENGTH);
    if (!details.ok) return details;
    await plan.updateExerciseItem(userId, id.value, { name: name.value, details: details.value });
    return OK;
  });
}

export async function removeExerciseItem(id: number): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    await plan.deleteExerciseItem(userId, v.value);
    return OK;
  });
}

export async function moveExerciseItem(id: number, direction: string): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    const dir = validateDirection(direction);
    if (!dir.ok) return dir;
    await plan.moveExerciseItem(userId, v.value, dir.value);
    return OK;
  });
}

// ── Meal plan ────────────────────────────────────────────────────────────────

export async function addMealItem(input: { weekday: number; slot: string; description: string }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const weekday = validateWeekday(input.weekday);
    if (!weekday.ok) return weekday;
    const slot = validateSlot(input.slot);
    if (!slot.ok) return slot;
    const description = validateText(input.description, "Description", MAX_TEXT_LENGTH);
    if (!description.ok) return description;
    await plan.insertMealItem(userId, { weekday: weekday.value, slot: slot.value, description: description.value });
    return OK;
  });
}

export async function editMealItem(input: { id: number; description: string }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const id = validateId(input.id);
    if (!id.ok) return id;
    const description = validateText(input.description, "Description", MAX_TEXT_LENGTH);
    if (!description.ok) return description;
    await plan.updateMealItem(userId, id.value, description.value);
    return OK;
  });
}

export async function removeMealItem(id: number): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    await plan.deleteMealItem(userId, v.value);
    return OK;
  });
}

export async function moveMealItem(id: number, direction: string): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    const dir = validateDirection(direction);
    if (!dir.ok) return dir;
    await plan.moveMealItem(userId, v.value, dir.value);
    return OK;
  });
}

export async function copyMealDay(weekday: number): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateWeekday(weekday);
    if (!v.ok) return v;
    const copied = await plan.copyMealDayToAllDays(userId, v.value);
    return copied ? OK : { ok: false, error: "That day has no meals to copy" };
  });
}

// ── Backup conditions ────────────────────────────────────────────────────────

export async function addCondition(input: { name: string; sleepScoreBelow?: number | null }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const name = validateText(input.name, "Name", MAX_NAME_LENGTH);
    if (!name.ok) return name;
    const threshold = validateThreshold(input.sleepScoreBelow);
    if (!threshold.ok) return threshold;
    await plan.insertCondition(userId, { name: name.value, sleepScoreBelow: threshold.value });
    return OK;
  });
}

export async function editCondition(input: { id: number; name: string; sleepScoreBelow?: number | null }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const id = validateId(input.id);
    if (!id.ok) return id;
    const name = validateText(input.name, "Name", MAX_NAME_LENGTH);
    if (!name.ok) return name;
    const threshold = validateThreshold(input.sleepScoreBelow);
    if (!threshold.ok) return threshold;
    await plan.updateCondition(userId, id.value, { name: name.value, sleepScoreBelow: threshold.value });
    return OK;
  });
}

/** Archive or restore. Conditions are never deleted — logs reference them. */
export async function archiveCondition(id: number, archived: boolean): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    await plan.setConditionArchived(userId, v.value, archived === true);
    return OK;
  });
}

export async function addConditionOption(input: { conditionId: number; name: string; details?: string | null }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const conditionId = validateId(input.conditionId);
    if (!conditionId.ok) return conditionId;
    const name = validateText(input.name, "Name", MAX_NAME_LENGTH);
    if (!name.ok) return name;
    const details = validateOptionalText(input.details, "Details", MAX_DETAILS_LENGTH);
    if (!details.ok) return details;
    const inserted = await plan.insertConditionOption(userId, {
      conditionId: conditionId.value, name: name.value, details: details.value,
    });
    return inserted ? OK : { ok: false, error: "Condition not found" };
  });
}

export async function editConditionOption(input: { id: number; name: string; details?: string | null }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const id = validateId(input.id);
    if (!id.ok) return id;
    const name = validateText(input.name, "Name", MAX_NAME_LENGTH);
    if (!name.ok) return name;
    const details = validateOptionalText(input.details, "Details", MAX_DETAILS_LENGTH);
    if (!details.ok) return details;
    await plan.updateConditionOption(userId, id.value, { name: name.value, details: details.value });
    return OK;
  });
}

export async function archiveConditionOption(id: number, archived: boolean): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    await plan.setConditionOptionArchived(userId, v.value, archived === true);
    return OK;
  });
}

// ── Mantras & strategies ─────────────────────────────────────────────────────

export async function addMindsetItem(input: { kind: string; text: string }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const kind = validateKind(input.kind);
    if (!kind.ok) return kind;
    const text = validateText(input.text, "Text", MAX_TEXT_LENGTH);
    if (!text.ok) return text;
    await plan.insertMindsetItem(userId, { kind: kind.value, text: text.value });
    return OK;
  });
}

export async function editMindsetItem(input: { id: number; text: string }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const id = validateId(input.id);
    if (!id.ok) return id;
    const text = validateText(input.text, "Text", MAX_TEXT_LENGTH);
    if (!text.ok) return text;
    await plan.updateMindsetItem(userId, id.value, text.value);
    return OK;
  });
}

export async function removeMindsetItem(id: number): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    await plan.deleteMindsetItem(userId, v.value);
    return OK;
  });
}

export async function moveMindsetItem(id: number, direction: string): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    const dir = validateDirection(direction);
    if (!dir.ok) return dir;
    await plan.moveMindsetItem(userId, v.value, dir.value);
    return OK;
  });
}

// ── Motivation lines ─────────────────────────────────────────────────────────

export async function addMotivationLine(text: string): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateText(text, "Text", MAX_TEXT_LENGTH);
    if (!v.ok) return v;
    await plan.insertMotivationLine(userId, v.value);
    return OK;
  });
}

export async function editMotivationLine(input: { id: number; text: string }): Promise<PlanResult> {
  return mutate(async (userId) => {
    const id = validateId(input.id);
    if (!id.ok) return id;
    const text = validateText(input.text, "Text", MAX_TEXT_LENGTH);
    if (!text.ok) return text;
    await plan.updateMotivationLine(userId, id.value, text.value);
    return OK;
  });
}

export async function toggleMotivationLine(id: number, active: boolean): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    await plan.setMotivationLineActive(userId, v.value, active === true);
    return OK;
  });
}

export async function removeMotivationLine(id: number): Promise<PlanResult> {
  return mutate(async (userId) => {
    const v = validateId(id);
    if (!v.ok) return v;
    await plan.deleteMotivationLine(userId, v.value);
    return OK;
  });
}
