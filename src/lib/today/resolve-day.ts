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

  for (const item of templates.meals.filter((m) => m.weekday === weekday).sort(byPosition)) {
    const log = logByItemId.get(item.id);
    meals[item.slot].push(
      log
        ? { mealPlanItemId: item.id, slot: log.slot, description: log.descriptionSnapshot, followed: log.followed, logged: true }
        : { mealPlanItemId: item.id, slot: item.slot, description: item.description, followed: false, logged: false },
    );
  }
  // Logs whose template item was since deleted (or removed from this weekday)
  // still show their snapshot.
  const listedIds = new Set(meals.breakfast.concat(meals.lunch, meals.dinner, meals.snack).map((m) => m.mealPlanItemId));
  const detached = [...orphanLogs, ...[...logByItemId.entries()].filter(([id]) => !listedIds.has(id)).map(([, l]) => l)];
  for (const l of detached) {
    meals[l.slot].push({
      mealPlanItemId: l.mealPlanItemId,
      slot: l.slot,
      description: l.descriptionSnapshot,
      followed: l.followed,
      logged: true,
    });
  }

  return { date, weekday, exercise: { items: exerciseItems, log: logState }, meals };
}
