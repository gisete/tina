// Builders for exercise_day_logs rows. Pure: templates/options in, the log
// snapshot to persist out. Logs copy the planned text at log time — editing a
// template afterwards never changes a past log.

import { isoWeekdayOf } from "./weekday";
import type {
  Condition,
  ConditionOption,
  ExerciseDayLog,
  ExercisePlanItem,
  LoggedExerciseItem,
} from "./types";
import type { Validated } from "./validate";

/** The weekday's template as unchecked log items, in plan order. */
export function plannedItemsFor(date: string, template: ExercisePlanItem[]): LoggedExerciseItem[] {
  const weekday = isoWeekdayOf(date);
  return template
    .filter((i) => i.weekday === weekday)
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((i) => ({ name: i.name, details: i.details, done: false }));
}

/**
 * Log row after toggling the item at `index`. With no usable existing log
 * (none, or skipped) a fresh 'planned' snapshot is taken from the template
 * first. Returns null when `index` is out of range.
 */
export function toggleExerciseItem(
  existing: ExerciseDayLog | null,
  planned: LoggedExerciseItem[],
  index: number,
): ExerciseDayLog | null {
  const base: ExerciseDayLog =
    existing && existing.status !== "skipped"
      ? existing
      : { status: "planned", conditionId: null, conditionNameSnapshot: null, items: planned, note: null };

  if (!Number.isInteger(index) || index < 0 || index >= base.items.length) return null;
  return {
    ...base,
    items: base.items.map((item, i) => (i === index ? { ...item, done: !item.done } : item)),
  };
}

/** A backup log from the chosen options of an active condition. */
export function buildBackupLog(
  condition: Pick<Condition, "id" | "name" | "archived">,
  options: ConditionOption[],
  selectedOptionIds: number[],
): Validated<ExerciseDayLog> {
  if (condition.archived) return { ok: false, error: "That condition is archived" };

  const chosen = options
    .filter((o) => o.conditionId === condition.id && !o.archived && selectedOptionIds.includes(o.id))
    .sort((a, b) => a.position - b.position || a.id - b.id);
  if (chosen.length === 0 || chosen.length !== new Set(selectedOptionIds).size) {
    return { ok: false, error: "Pick at least one option from this condition" };
  }

  return {
    ok: true,
    value: {
      status: "backup",
      conditionId: condition.id,
      conditionNameSnapshot: condition.name,
      items: chosen.map((o) => ({ name: o.name, details: o.details, done: false })),
      note: null,
    },
  };
}

export function skippedExerciseLog(): ExerciseDayLog {
  return { status: "skipped", conditionId: null, conditionNameSnapshot: null, items: [], note: null };
}
