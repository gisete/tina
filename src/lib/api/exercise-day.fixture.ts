// npx tsx src/lib/api/exercise-day.fixture.ts
// The exercise/energy blocks: honest absence (empty array vs not_synced), start-date listing, nulls never 0.
import type { WorkoutInput } from "@/lib/analytics/exercise";
import { buildExerciseBlocks, type ExerciseDayInput } from "./exercise-day";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
function eq(label: string, actual: unknown, expected: unknown): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const W = (over: Partial<WorkoutInput>): WorkoutInput => ({
  id: "w", exerciseDate: "2026-11-03", exerciseType: "WALKING", displayName: "Walk",
  startMs: Date.parse("2026-11-03T18:17:43Z"), endMs: Date.parse("2026-11-03T18:37:56Z"), startUtcOffsetSeconds: 0, endUtcOffsetSeconds: 0,
  activeDurationSeconds: 1213, caloriesKcal: 100, distanceMeters: 1500, avgHeartRateBpm: 100,
  lightZoneSeconds: 1200, moderateZoneSeconds: 0, vigorousZoneSeconds: 0, peakZoneSeconds: 0,
  recordingMethod: "ACTIVELY_MEASURED", hrSamples: [], ...over,
});
const input = (over: Partial<ExerciseDayInput>): ExerciseDayInput => ({
  sessions: [], coverageStart: "2026-03-11", totalCaloriesKcal: 2000, activeCaloriesKcal: 400, hasWearEvidence: true, ...over,
});
const cursor = "2026-11-12";
const today = "2026-11-12";

// Synced day with no workouts: an EMPTY ARRAY and a measured zero.
const empty = buildExerciseBlocks("2026-11-09", today, cursor, input({}));
eq("empty status", empty.exercise.status, "synced");
if (empty.exercise.status === "synced") {
  eq("empty sessions", empty.exercise.sessions, []);
  eq("empty count", empty.exercise.summary.workoutCount, 0);
  eq("empty kcal is a measured zero", empty.exercise.summary.workoutCaloriesKcal, 0);
}

// Not synced (after the cursor, and before exercise history began): unavailable, no sessions key.
eq("after cursor", buildExerciseBlocks("2026-11-13", today, cursor, input({})).exercise, { status: "unavailable", reason: "not_synced" });
eq("before history", buildExerciseBlocks("2026-01-05", today, cursor, input({})).exercise, { status: "unavailable", reason: "not_synced" });
eq("no cursor", buildExerciseBlocks("2026-11-09", today, null, input({})).exercise, { status: "unavailable", reason: "not_synced" });
eq("not synced energy", buildExerciseBlocks("2026-01-05", today, cursor, input({ totalCaloriesKcal: null, activeCaloriesKcal: null })).energy,
  { totalCalories: { status: "unavailable", reason: "not_synced" }, activeCalories: { status: "unavailable", reason: "not_synced" } });

// 2026-11-03: manual + measured walk both listed, no dedupe; manual labelled.
const pair = buildExerciseBlocks("2026-11-03", today, cursor, input({
  sessions: [
    W({ id: "m", recordingMethod: "MANUAL", startMs: Date.parse("2026-11-03T18:00:00Z"), endMs: Date.parse("2026-11-03T18:20:00Z"), activeDurationSeconds: 1200, caloriesKcal: null, avgHeartRateBpm: null }),
    W({ id: "a" }),
  ],
}));
if (pair.exercise.status === "synced") {
  eq("pair ids", pair.exercise.sessions.map((s) => s.id), ["m", "a"]);
  eq("pair methods", pair.exercise.sessions.map((s) => s.recordingMethod.kind), ["manual", "tracked"]);
  eq("pair manual nulls", [pair.exercise.sessions[0].caloriesKcal, pair.exercise.sessions[0].averageHeartRate], [null, null]);
  eq("pair summary", [pair.exercise.summary.workoutCount, pair.exercise.summary.sessionsMissingCalories, pair.exercise.summary.workoutCaloriesKcal], [2, 1, 100]);
} else assert(false, "pair is synced");

// Cross-midnight workout is listed on the day it was passed for (its start date), with endDate on the next.
const cross = buildExerciseBlocks("2026-11-04", today, cursor, input({
  sessions: [W({ exerciseDate: "2026-11-04", startMs: Date.parse("2026-11-04T23:45:00Z"), endMs: Date.parse("2026-11-05T00:20:00Z") })],
}));
if (cross.exercise.status === "synced") eq("cross", [cross.exercise.sessions[0].date, cross.exercise.sessions[0].endDate, cross.exercise.sessions[0].crossesMidnight], ["2026-11-04", "2026-11-05", true]);

// Today is partial.
const t = buildExerciseBlocks(today, today, cursor, input({ totalCaloriesKcal: 1035, activeCaloriesKcal: 252 }));
eq("today partial", t.exercise.status === "synced" && t.exercise.partialDay, true);
eq("today energy flag", t.energy.totalCalories, { status: "measured", value: 1035, unit: "kcal", flags: ["partial_day"] });

// Resting-only fill: total not_worn, share of total null, never measured.
const fill = buildExerciseBlocks("2026-10-11", today, cursor, input({ totalCaloriesKcal: 1488.3264, activeCaloriesKcal: null, hasWearEvidence: false }));
eq("fill total", fill.energy.totalCalories, { status: "unavailable", reason: "not_worn" });
eq("fill active", fill.energy.activeCalories, { status: "unavailable", reason: "not_worn" });
if (fill.exercise.status === "synced") eq("fill share/total", [fill.exercise.summary.totalCaloriesKcal, fill.exercise.summary.shareOfTotalCalories], [null, null]);

// Null active calories with wear evidence: total measured, active not_supported.
const wear = buildExerciseBlocks("2026-07-04", today, cursor, input({ totalCaloriesKcal: 2100, activeCaloriesKcal: null, hasWearEvidence: true }));
eq("wear total", wear.energy.totalCalories, { status: "measured", value: 2100, unit: "kcal" });
eq("wear active", wear.energy.activeCalories, { status: "unavailable", reason: "not_supported" });

console.log("exercise-day fixture ok");
