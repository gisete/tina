// Phase 2 spot-check: run with `npx tsx scripts/today-engines-check.ts`
// (also under TZ=America/Los_Angeles / Pacific/Auckland to prove UTC-independence).
import assert from "node:assert/strict";
import {
  isoWeekdayOf, resolveDay, pickMotivationLine, conditionsToHighlight,
  buildSleepNudge, validateLogDate, loggableDates, isSyncStale, plannedItemsFor, toggleExerciseItem, buildBackupLog, skippedExerciseLog,
  type ConditionOption,
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
  { id: 1, mealPlanItemId: 10, slot: "breakfast", descriptionSnapshot: "Oats", followed: true },
  { id: 2, mealPlanItemId: null, slot: "lunch", descriptionSnapshot: "Old salad (deleted item)", followed: true },
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

// 6. Phase 4: orphaned meal log (FK nulled by copy-day) is matched back to its recreated template item.
const recreated: MealPlanItem[] = [{ id: 99, weekday: 3, slot: "breakfast", position: 0, description: "Oats" }];
const orphan: MealLog[] = [{ id: 5, mealPlanItemId: null, slot: "breakfast", descriptionSnapshot: "Oats", followed: true }];
const adopted = resolveDay("2026-10-21", { exercise: [], meals: recreated }, { exercise: null, meals: orphan });
assert.deepEqual(adopted.meals.breakfast.map((m) => [m.mealPlanItemId, m.logId, m.followed]), [[99, 5, true]]); // one row, not two
const twoSame: MealLog[] = [...orphan, { id: 6, mealPlanItemId: null, slot: "breakfast", descriptionSnapshot: "Oats", followed: false }];
const dup = resolveDay("2026-10-21", { exercise: [], meals: recreated }, { exercise: null, meals: twoSame });
assert.equal(dup.meals.breakfast.length, 2); // second identical orphan stays visible, never silently dropped
console.log("orphan adoption:", JSON.stringify(adopted.meals.breakfast));

// 7. Exercise log builders.
const tplItems = plannedItemsFor("2026-10-21", exTpl);
assert.deepEqual(tplItems.map((i) => i.name), ["Run", "Squats"]);
const t1 = toggleExerciseItem(null, tplItems, 0)!;
assert.equal(t1.status, "planned"); assert.equal(t1.items[0].done, true); assert.equal(t1.items[1].done, false);
const t2 = toggleExerciseItem(t1, plannedItemsFor("2026-10-21", editedTpl), 0)!; // template edited since: snapshot wins
assert.equal(t2.items[0].name, "Run"); assert.equal(t2.items[0].done, false);
assert.equal(toggleExerciseItem(t1, tplItems, 5), null);
assert.equal(toggleExerciseItem(skippedExerciseLog(), tplItems, 1)!.status, "planned"); // toggling after skip starts a planned log
const opts: ConditionOption[] = [
  { id: 1, conditionId: 7, name: "Walk", details: "15 min", position: 1, archived: false },
  { id: 2, conditionId: 7, name: "Stretch", details: null, position: 0, archived: false },
  { id: 3, conditionId: 7, name: "Old", details: null, position: 2, archived: true },
  { id: 4, conditionId: 8, name: "Other cond", details: null, position: 0, archived: false },
];
const bk = buildBackupLog({ id: 7, name: "Low energy", archived: false }, opts, [1, 2]);
assert.ok(bk.ok && bk.value.status === "backup" && bk.value.conditionNameSnapshot === "Low energy");
assert.deepEqual(bk.ok && bk.value.items.map((i) => i.name), ["Stretch", "Walk"]); // plan order
assert.ok(!buildBackupLog({ id: 7, name: "Low energy", archived: false }, opts, [3]).ok); // archived option
assert.ok(!buildBackupLog({ id: 7, name: "Low energy", archived: false }, opts, [4]).ok); // other condition's option
assert.ok(!buildBackupLog({ id: 7, name: "Low energy", archived: false }, opts, [1, 4]).ok); // mixed
assert.ok(!buildBackupLog({ id: 7, name: "Low energy", archived: true }, opts, [1]).ok); // archived condition
assert.ok(!buildBackupLog({ id: 7, name: "Low energy", archived: false }, opts, []).ok);
console.log("backup log:", JSON.stringify(bk.ok && bk.value));

// 8. Log-date window + staleness.
assert.deepEqual(loggableDates("2026-03-01"), ["2026-03-01", "2026-02-28"]);
assert.ok(validateLogDate("2026-10-21", "2026-10-21").ok);
assert.ok(validateLogDate("2026-10-20", "2026-10-21").ok);
for (const bad of ["2026-10-19", "2026-10-22", "2026-10-2", "not-a-date", "", null, 20261021, "2026-10-21T00:00:00Z"]) assert.ok(!validateLogDate(bad, "2026-10-21").ok, String(bad));
assert.equal(isSyncStale(null, 1e12, 6), true);
assert.equal(isSyncStale(1e12 - 5 * 3_600_000, 1e12, 6), false);
assert.equal(isSyncStale(1e12 - 7 * 3_600_000, 1e12, 6), true);
console.log("log window ok; rejected: 2026-10-19, 2026-10-22, malformed, non-string");

// 9. Phase 5 nudge.
assert.equal(buildSleepNudge(null, conds), null);
assert.equal(buildSleepNudge(80, conds), null); // above every threshold
assert.deepEqual(buildSleepNudge(64, conds), { score: 64, conditionIds: [1], message: "Last night scored 64, consider this." });
assert.deepEqual(buildSleepNudge(55, conds)?.conditionIds, [1, 4]); // archived 3 and null-threshold 2 never
console.log("nudge 64 →", JSON.stringify(buildSleepNudge(64, conds)), "| 55 →", buildSleepNudge(55, conds)?.conditionIds);
console.log("ALL CHECKS PASSED");
