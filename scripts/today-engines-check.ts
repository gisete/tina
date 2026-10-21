// Phase 2 spot-check: run with `npx tsx scripts/today-engines-check.ts`
// (also under TZ=America/Los_Angeles / Pacific/Auckland to prove UTC-independence).
import assert from "node:assert/strict";
import {
  isoWeekdayOf, resolveDay, pickMotivationLine, conditionsToHighlight,
  type ExercisePlanItem, type MealPlanItem, type MotivationLine, type ExerciseDayLog, type MealLog,
} from "@/lib/today";

console.log("TZ:", Intl.DateTimeFormat().resolvedOptions().timeZone);

// 1. Weekdays. 2026-10-18 is a Sunday, 2026-10-19 a Monday. In America/Los_Angeles
// new Date("2026-10-18") (UTC midnight) is Saturday evening — the case UTC gets wrong.
assert.equal(isoWeekdayOf("2026-10-18"), 7);
assert.equal(isoWeekdayOf("2026-10-19"), 1);
assert.equal(isoWeekdayOf("2026-10-21"), 3);
console.log("weekday: Sun 2026-10-18 →", isoWeekdayOf("2026-10-18"), "| Mon 2026-10-19 →", isoWeekdayOf("2026-10-19"));

// 2. Motivation: stable across calls, varies across dates.
const lines: MotivationLine[] = [1, 2, 3, 4, 5].map((id) => ({ id, text: `line ${id}`, active: id !== 3 }));
const a = pickMotivationLine("2026-10-21", lines);
assert.equal(pickMotivationLine("2026-10-21", [...lines].reverse())?.id, a?.id); // order-insensitive
const picks = Array.from({ length: 14 }, (_, i) => pickMotivationLine(`2026-10-${String(8 + i).padStart(2, "0")}`, lines)!.id);
assert.ok(new Set(picks).size > 1);
assert.ok(!picks.includes(3)); // inactive never picked
assert.equal(pickMotivationLine("2026-10-21", []), null);
assert.equal(pickMotivationLine("2026-10-21", [{ id: 1, text: "x", active: false }]), null);
console.log("motivation: 14 dates →", picks.join(","), "| empty →", pickMotivationLine("2026-10-21", []));

// 3. Backup log round-trip + snapshot rule.
const exTpl: ExercisePlanItem[] = [
  { id: 1, weekday: 3, position: 1, name: "Squats", details: "3×12" },
  { id: 2, weekday: 3, position: 0, name: "Run", details: "20 min" },
  { id: 3, weekday: 4, position: 0, name: "Rest-day yoga", details: null },
];
const mealTpl: MealPlanItem[] = [
  { id: 10, weekday: 3, slot: "breakfast", position: 0, description: "Oats" },
  { id: 11, weekday: 3, slot: "lunch", position: 0, description: "Salad" },
];
const none = { exercise: null, meals: [] as MealLog[] };
const unlogged = resolveDay("2026-10-21", { exercise: exTpl, meals: mealTpl }, none);
assert.deepEqual(unlogged.exercise.items.map((i) => i.name), ["Run", "Squats"]);
assert.equal(unlogged.exercise.log.kind, "unlogged");

const backupLog: ExerciseDayLog = {
  status: "backup", conditionId: 7, conditionNameSnapshot: "Low energy", note: null,
  items: [{ name: "Walk", details: "15 min", done: false }],
};
const editedTpl = exTpl.map((i) => ({ ...i, name: i.name + " (EDITED)" }));
const backup = resolveDay("2026-10-21", { exercise: editedTpl, meals: mealTpl }, { exercise: backupLog, meals: [] });
assert.deepEqual(backup.exercise.log, { kind: "backup", conditionId: 7, conditionName: "Low energy", items: backupLog.items });
assert.deepEqual(backup.exercise.items, backupLog.items); // snapshot wins over edited template
assert.equal(JSON.stringify(JSON.parse(JSON.stringify(backup))), JSON.stringify(backup)); // JSON-safe
const planned = resolveDay("2026-10-21", { exercise: editedTpl, meals: [] }, { exercise: { status: "planned", conditionId: null, conditionNameSnapshot: null, note: null, items: [{ name: "Run", details: "20 min", done: true }] }, meals: [] });
assert.equal(planned.exercise.log.kind, "planned");
assert.equal(planned.exercise.items[0].name, "Run");
assert.equal(resolveDay("2026-10-21", { exercise: exTpl, meals: [] }, { exercise: { ...backupLog, status: "skipped" }, meals: [] }).exercise.log.kind, "skipped");
console.log("backup round-trip:", JSON.stringify(backup.exercise.log));

// 4. Meals: logged snapshot survives template edit/delete; orphan still shown.
const mealLogs: MealLog[] = [
  { mealPlanItemId: 10, slot: "breakfast", descriptionSnapshot: "Oats", followed: true },
  { mealPlanItemId: null, slot: "lunch", descriptionSnapshot: "Old salad (deleted item)", followed: true },
];
const meals = resolveDay("2026-10-21", { exercise: [], meals: [{ ...mealTpl[0], description: "Eggs" }] }, { exercise: null, meals: mealLogs });
assert.deepEqual(meals.meals.breakfast.map((m) => [m.description, m.followed]), [["Oats", true]]);
assert.deepEqual(meals.meals.lunch.map((m) => [m.description, m.mealPlanItemId]), [["Old salad (deleted item)", null]]);
console.log("meals:", JSON.stringify(meals.meals.breakfast), JSON.stringify(meals.meals.lunch));

// 5. Sleep nudge.
const conds = [
  { id: 1, sleepScoreBelow: 70, archived: false },
  { id: 2, sleepScoreBelow: null, archived: false },
  { id: 3, sleepScoreBelow: 70, archived: true },
  { id: 4, sleepScoreBelow: 60, archived: false },
];
assert.deepEqual(conditionsToHighlight(null, conds), []);
assert.deepEqual(conditionsToHighlight(64, conds), [1]);
assert.deepEqual(conditionsToHighlight(70, conds), []); // strictly below
console.log("nudge: null →", conditionsToHighlight(null, conds), "| 64 →", conditionsToHighlight(64, conds), "| 70 →", conditionsToHighlight(70, conds));
console.log("ALL CHECKS PASSED");
