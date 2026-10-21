// Shared types for the Today engines. Plain, JSON-safe data only — no
// React/Next/DB imports, so server and client code can import freely.

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export type MindsetKind = "mantra" | "strategy";

export type ExerciseLogStatus = "planned" | "backup" | "skipped";

// ── Templates ────────────────────────────────────────────────────────────────

export interface ExercisePlanItem {
  id: number;
  weekday: IsoWeekday;
  position: number;
  name: string;
  details: string | null;
}

export interface MealPlanItem {
  id: number;
  weekday: IsoWeekday;
  slot: MealSlot;
  position: number;
  description: string;
}

export interface ConditionOption {
  id: number;
  conditionId: number;
  name: string;
  details: string | null;
  position: number;
  archived: boolean;
}

export interface Condition {
  id: number;
  name: string;
  position: number;
  /** Highlight this condition when last night's score is strictly below this. */
  sleepScoreBelow: number | null;
  archived: boolean;
}

export interface MotivationLine {
  id: number;
  text: string;
  active: boolean;
}

// ── Logs (snapshots) ─────────────────────────────────────────────────────────

/** One exercise item as it was planned/chosen at log time. */
export interface LoggedExerciseItem {
  name: string;
  details: string | null;
  done: boolean;
}

export interface ExerciseDayLog {
  status: ExerciseLogStatus;
  conditionId: number | null;
  conditionNameSnapshot: string | null;
  items: LoggedExerciseItem[];
  note: string | null;
}

export interface MealLog {
  /** Null once the template item has been deleted (FK set null). */
  mealPlanItemId: number | null;
  slot: MealSlot;
  descriptionSnapshot: string;
  followed: boolean;
}

// ── Resolved day ─────────────────────────────────────────────────────────────

export type ExerciseLogState =
  | { kind: "unlogged" }
  | { kind: "planned"; items: LoggedExerciseItem[] }
  | { kind: "backup"; conditionId: number | null; conditionName: string; items: LoggedExerciseItem[] }
  | { kind: "skipped" };

export interface TodayMealItem {
  /** Null for an orphaned log whose template item was deleted. */
  mealPlanItemId: number | null;
  slot: MealSlot;
  description: string;
  followed: boolean;
  /** True when a meal_logs row exists for this item. */
  logged: boolean;
}

export interface TodayPlan {
  /** Local calendar date, "YYYY-MM-DD". */
  date: string;
  weekday: IsoWeekday;
  exercise: {
    /** Items to display: the log snapshot once logged, else the weekday template. */
    items: LoggedExerciseItem[];
    log: ExerciseLogState;
  };
  meals: Record<MealSlot, TodayMealItem[]>;
}

// ── Plan editor payload ──────────────────────────────────────────────────────

export interface MindsetItem {
  id: number;
  kind: MindsetKind;
  text: string;
  position: number;
}

export interface ConditionWithOptions extends Condition {
  options: ConditionOption[];
}

/** Everything the plan editor renders, as plain serializable data. */
export interface PlanData {
  exercise: ExercisePlanItem[];
  meals: MealPlanItem[];
  conditions: ConditionWithOptions[];
  mindset: MindsetItem[];
  motivation: MotivationLine[];
}
