// Input validation for the plan editor. Pure: raw (untrusted) values in,
// a tagged result out. Server Actions call these before any DB write — the
// DB columns are plain text/smallint, so this is where the allowed values
// (weekday 1..7, slot/kind enums, lengths) are enforced.

import { MEAL_SLOTS, type IsoWeekday, type MealSlot, type MindsetKind } from "./types";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_NAME_LENGTH = 120;
export const MAX_DETAILS_LENGTH = 200;
export const MAX_TEXT_LENGTH = 500;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function validateId(raw: unknown): Validated<number> {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
    ? { ok: true, value: raw }
    : fail("Invalid id");
}

export function validateWeekday(raw: unknown): Validated<IsoWeekday> {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 7
    ? { ok: true, value: raw as IsoWeekday }
    : fail("Weekday must be 1 (Mon) to 7 (Sun)");
}

export function validateSlot(raw: unknown): Validated<MealSlot> {
  return typeof raw === "string" && (MEAL_SLOTS as readonly string[]).includes(raw)
    ? { ok: true, value: raw as MealSlot }
    : fail("Unknown meal slot");
}

export function validateKind(raw: unknown): Validated<MindsetKind> {
  return raw === "mantra" || raw === "strategy" ? { ok: true, value: raw } : fail("Unknown kind");
}

/** Trimmed, required, length-capped text. */
export function validateText(raw: unknown, label: string, max: number): Validated<string> {
  if (typeof raw !== "string") return fail(`${label} is required`);
  const value = raw.trim();
  if (value.length === 0) return fail(`${label} is required`);
  if (value.length > max) return fail(`${label} must be at most ${max} characters`);
  return { ok: true, value };
}

/** Trimmed optional text; empty / null / undefined → null. */
export function validateOptionalText(raw: unknown, label: string, max: number): Validated<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return fail(`${label} must be text`);
  const value = raw.trim();
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > max) return fail(`${label} must be at most ${max} characters`);
  return { ok: true, value };
}

/** Optional "sleep score below" threshold: null, or an integer 1..100. */
export function validateThreshold(raw: unknown): Validated<number | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 100
    ? { ok: true, value: raw }
    : fail("Sleep score threshold must be a whole number from 1 to 100");
}

export type MoveDirection = "up" | "down";

export function validateDirection(raw: unknown): Validated<MoveDirection> {
  return raw === "up" || raw === "down" ? { ok: true, value: raw } : fail("Invalid direction");
}

/**
 * Moves `id` one step within an ordered id list. Returns the list unchanged
 * when the id is absent or already at the edge.
 */
export function moveId(orderedIds: number[], id: number, direction: MoveDirection): number[] {
  const from = orderedIds.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= orderedIds.length) return orderedIds;
  const next = [...orderedIds];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * Form-text → number for optional numeric inputs: blank → null, otherwise the
 * parsed number (NaN when unparseable, which {@link validateThreshold} rejects).
 */
export function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : Number(trimmed);
}
