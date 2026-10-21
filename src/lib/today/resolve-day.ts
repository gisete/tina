import { isoWeekdayOf } from "./weekday";
import {
  MEAL_SLOTS,
  type ExerciseDayLog,
  type ExerciseLogState,
  type ExercisePlanItem,
  type LoggedExerciseItem,
  type MealLog,
  type MealPlanItem,
  type MealSlot,
  type TodayMealItem,
  type TodayPlan,
} from "./types";

export interface DayTemplates {
  exercise: ExercisePlanItem[];
  meals: MealPlanItem[];
}

export interface DayLogs {
  exercise: ExerciseDayLog | null;
  meals: MealLog[];
}

const byPosition = <T extends { position: number; id: number }>(a: T, b: T): number =>
  a.position - b.position || a.id - b.id;

function resolveExerciseLog(log: ExerciseDayLog | null): ExerciseLogState {
  if (!log) return { kind: "unlogged" };
  switch (log.status) {
    case "planned":
      return { kind: "planned", items: log.items };
    case "backup":
      return {
        kind: "backup",
        conditionId: log.conditionId,
        conditionName: log.conditionNameSnapshot ?? "Backup",
        items: log.items,
      };
    case "skipped":
      return { kind: "skipped" };
  }
}

/**
 * Resolves one calendar day into a serializable plan. Once a day is logged,
 * the log's snapshot is the source of display text — templates are consulted
 * only to list items that have not been logged yet (and, for meals, to avoid
 * listing a logged template item twice).
 */
export function resolveDay(date: string, templates: DayTemplates, logs: DayLogs): TodayPlan {
  const weekday = isoWeekdayOf(date);

  const logState = resolveExerciseLog(logs.exercise);
  const templateItems: LoggedExerciseItem[] = templates.exercise
    .filter((i) => i.weekday === weekday)
    .sort(byPosition)
    .map((i) => ({ name: i.name, details: i.details, done: false }));
  const exerciseItems =
    logState.kind === "planned" || logState.kind === "backup" ? logState.items : templateItems;

  const logByItemId = new Map<number, MealLog>();
  const orphanLogs: MealLog[] = [];
  for (const l of logs.meals) {
    if (l.mealPlanItemId === null) orphanLogs.push(l);
    else logByItemId.set(l.mealPlanItemId, l);
  }

  const meals = Object.fromEntries(MEAL_SLOTS.map((s) => [s, [] as TodayMealItem[]])) as Record<
    MealSlot,
    TodayMealItem[]
  >;

  const shown = new Set<MealLog>();
  for (const item of templates.meals.filter((m) => m.weekday === weekday).sort(byPosition)) {
    // A log whose template item was recreated (e.g. "copy day to all days"
    // deletes and re-inserts items, nulling the FK) is matched back by slot +
    // the text it was logged with, so the meal doesn't appear twice.
    const log =
      logByItemId.get(item.id) ??
      orphanLogs.find((o) => !shown.has(o) && o.slot === item.slot && o.descriptionSnapshot === item.description);
    if (log) shown.add(log);
    meals[item.slot].push(
      log
        ? { mealPlanItemId: item.id, logId: log.id, slot: log.slot, description: log.descriptionSnapshot, followed: log.followed, logged: true }
        : { mealPlanItemId: item.id, logId: null, slot: item.slot, description: item.description, followed: false, logged: false },
    );
  }

  // Remaining logs (template item deleted, or moved off this weekday) still
  // show their snapshot.
  for (const l of logs.meals) {
    if (shown.has(l)) continue;
    meals[l.slot].push({
      mealPlanItemId: l.mealPlanItemId,
      logId: l.id,
      slot: l.slot,
      description: l.descriptionSnapshot,
      followed: l.followed,
      logged: true,
    });
  }

  return { date, weekday, exercise: { items: exerciseItems, log: logState }, meals };
}
