// npx tsx src/lib/analytics/exercise.fixture.ts
import {
  buildWorkout,
  buildWorkouts,
  classifyDailyEnergy,
  exerciseTypeLabel,
  isExerciseSynced,
  mapRecordingMethod,
  rollupWorkouts,
  type WorkoutInput,
} from "./exercise";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const W = (over: Partial<WorkoutInput>): WorkoutInput => ({
  id: "w1",
  exerciseDate: "2026-11-04",
  exerciseType: "WALKING",
  displayName: "Walk",
  startMs: Date.parse("2026-11-04T18:35:29Z"),
  endMs: Date.parse("2026-11-04T19:01:06Z"),
  startUtcOffsetSeconds: 0,
  endUtcOffsetSeconds: 0,
  activeDurationSeconds: 1536,
  caloriesKcal: 159,
  distanceMeters: 1587.445,
  avgHeartRateBpm: 99,
  lightZoneSeconds: 1560,
  moderateZoneSeconds: 0,
  vigorousZoneSeconds: 0,
  peakZoneSeconds: 0,
  recordingMethod: "ACTIVELY_MEASURED",
  hrSamples: [],
  ...over,
});

// Normal session, winter (+00:00): local times keep the offset; a real 0 zone stays 0.
const normal = buildWorkout(W({}));
eq("normal start", normal.startLocal, "2026-11-04T18:35:29+00:00");
eq("normal end", normal.endLocal, "2026-11-04T19:01:06+00:00");
eq("normal duration", normal.durationMinutes, 25.6);
eq("normal zones", normal.zoneMinutes, { light: 26, moderate: 0, vigorous: 0, peak: 0 });
eq("normal not cross", normal.crossesMidnight, false);
eq("normal tracked", normal.recordingMethod, { kind: "tracked", raw: "ACTIVELY_MEASURED" });

// Summer (+01:00) vs winter (+00:00): the same UTC hour reads one hour later in summer.
const summer = buildWorkout(W({
  id: "s", exerciseDate: "2026-07-14",
  startMs: Date.parse("2026-07-14T17:05:00Z"), endMs: Date.parse("2026-07-14T17:35:00Z"),
  startUtcOffsetSeconds: 3600, endUtcOffsetSeconds: 3600,
}));
eq("summer start", summer.startLocal, "2026-07-14T18:05:00+01:00");
eq("summer end", summer.endLocal, "2026-07-14T18:35:00+01:00");
const winter = buildWorkout(W({
  id: "t", exerciseDate: "2026-01-14",
  startMs: Date.parse("2026-01-14T17:05:00Z"), endMs: Date.parse("2026-01-14T17:35:00Z"),
}));
eq("winter start", winter.startLocal, "2026-01-14T17:05:00+00:00");

// Missing end offset falls back to the start offset; a non-Lisbon offset is honoured.
const travel = buildWorkout(W({
  startMs: Date.parse("2026-09-25T00:00:00Z"), endMs: Date.parse("2026-09-25T00:30:00Z"),
  exerciseDate: "2026-09-25", startUtcOffsetSeconds: 32400, endUtcOffsetSeconds: null,
}));
eq("tokyo start", travel.startLocal, "2026-09-25T09:00:00+09:00");
eq("tokyo end", travel.endLocal, "2026-09-25T09:30:00+09:00");

// Paused workout (real 2026-10-23 14:04): 942 s active vs 1389 s elapsed; speed/pace use the active time.
const paused = buildWorkout(W({
  id: "p", exerciseDate: "2026-10-23",
  startMs: Date.parse("2026-10-23T13:04:00Z"), endMs: Date.parse("2026-10-23T13:27:09Z"),
  startUtcOffsetSeconds: 3600, endUtcOffsetSeconds: 3600,
  activeDurationSeconds: 942, distanceMeters: 1000,
}));
eq("paused duration", paused.durationMinutes, 23.2);
eq("paused active", paused.activeDurationMinutes, 15.7);
eq("paused pace uses active", paused.paceSecondsPerKm, 942);
eq("paused speed uses active", paused.speedKmh, 3.8);

// Crosses local midnight: stays on its start date.
const cross = buildWorkout(W({
  id: "c", exerciseDate: "2026-11-04",
  startMs: Date.parse("2026-11-04T23:45:00Z"), endMs: Date.parse("2026-11-05T00:20:00Z"),
}));
eq("cross date", cross.date, "2026-11-04");
eq("cross endDate", cross.endDate, "2026-11-05");
eq("cross flag", cross.crossesMidnight, true);
eq("cross startLocal", cross.startLocal, "2026-11-04T23:45:00+00:00");
eq("cross endLocal", cross.endLocal, "2026-11-05T00:20:00+00:00");

// Missing zones and calories: null, never 0.
const noZones = buildWorkout(W({
  lightZoneSeconds: null, moderateZoneSeconds: null, vigorousZoneSeconds: null, peakZoneSeconds: null,
  caloriesKcal: null, avgHeartRateBpm: null,
}));
eq("no zones", noZones.zoneMinutes, { light: null, moderate: null, vigorous: null, peak: null });
eq("no calories", noZones.caloriesKcal, null);
eq("no avg hr", noZones.averageHeartRate, null);

// No HR samples vs with samples (only those inside the window count).
eq("without hr", [normal.hasHeartRateSamples, normal.heartRate], [false, null]);
const withHr = buildWorkout(W({
  hrSamples: [
    { tMs: Date.parse("2026-11-04T18:00:00Z"), bpm: 200 }, // before start: ignored
    { tMs: Date.parse("2026-11-04T18:36:00Z"), bpm: 90 },
    { tMs: Date.parse("2026-11-04T18:40:00Z"), bpm: 120 },
    { tMs: Date.parse("2026-11-04T18:50:00Z"), bpm: 110 },
  ],
}));
assert(withHr.hasHeartRateSamples === true, "has hr");
if (withHr.hasHeartRateSamples) eq("hr stats", withHr.heartRate, { min: 90, avg: 106.7, max: 120, sampleCount: 3 });

// Distance 0 for a non-distance activity (Google) and absent distance: no pace, no speed, no distance.
const strength = buildWorkout(W({ exerciseType: "STRENGTH_TRAINING", displayName: null, distanceMeters: 0 }));
eq("distance 0", [strength.distanceMeters, strength.speedKmh, strength.paceSecondsPerKm], [null, null, null]);
eq("fallback name", strength.name, "Strength training");
eq("absent distance", buildWorkout(W({ distanceMeters: null })).speedKmh, null);

// Manual session and recording-method mapping.
const manual = buildWorkout(W({ id: "m", recordingMethod: "MANUAL" }));
eq("manual", manual.recordingMethod, { kind: "manual", raw: "MANUAL" });
eq("auto", mapRecordingMethod("PASSIVELY_MEASURED"), { kind: "auto_detected", raw: "PASSIVELY_MEASURED" });
eq("unknown keeps raw", mapRecordingMethod("SOMETHING_NEW"), { kind: "unknown", raw: "SOMETHING_NEW" });
eq("label", exerciseTypeLabel("SPORT"), "Sport");

// 2026-11-03 overlap pair: both survive, ordered by start, no dedupe.
const pair = buildWorkouts([
  W({ id: "measured", exerciseDate: "2026-11-03", startMs: Date.parse("2026-11-03T18:17:43Z"), endMs: Date.parse("2026-11-03T18:37:56Z"), activeDurationSeconds: 1200, caloriesKcal: 100 }),
  W({ id: "manual", recordingMethod: "MANUAL", exerciseDate: "2026-11-03", startMs: Date.parse("2026-11-03T18:00:00Z"), endMs: Date.parse("2026-11-03T18:20:00Z"), activeDurationSeconds: 1200, caloriesKcal: null }),
]);
eq("pair ids", pair.map((p) => p.id), ["manual", "measured"]);
const pairRoll = rollupWorkouts(pair, 2000);
eq("pair rollup", pairRoll, { workoutCount: 2, activeMinutes: 40, workoutCaloriesKcal: 100, sessionsMissingCalories: 1, shareOfTotalCalories: 0.05 });

// Rollup: zero workouts is a measured zero; sessions with no calories at all are null.
eq("zero day", rollupWorkouts([], 2100), { workoutCount: 0, activeMinutes: 0, workoutCaloriesKcal: 0, sessionsMissingCalories: 0, shareOfTotalCalories: 0 });
eq("all null kcal", rollupWorkouts([noZones], 2100).workoutCaloriesKcal, null);
eq("unknown total", rollupWorkouts([normal], null).shareOfTotalCalories, null);

// Coverage: inside [coverageStart, syncedThrough] the slice ran, even with no stored row for the day.
const cov = { syncedThrough: "2026-11-12", coverageStart: "2026-03-11" };
eq("synced, nothing stored that day", isExerciseSynced({ ...cov, date: "2026-11-09" }), true);
eq("before backfill", isExerciseSynced({ ...cov, date: "2026-01-05" }), false);
eq("after cursor", isExerciseSynced({ ...cov, date: "2026-11-13" }), false);
eq("no cursor", isExerciseSynced({ ...cov, syncedThrough: null, date: "2026-11-05" }), false);
eq("no coverage", isExerciseSynced({ ...cov, coverageStart: null, date: "2026-11-05" }), false);

// Energy: resting-only fill (null active, no wear evidence) is not_worn; with wear evidence the total is measured
// and the missing active figure is not_supported (never not_worn).
const en = { today: "2026-11-12", synced: true };
eq("resting fill", classifyDailyEnergy({ ...en, date: "2026-10-11", totalCaloriesKcal: 1488.3264, activeCaloriesKcal: null, hasWearEvidence: false }),
  { total: { status: "unavailable", reason: "not_worn" }, active: { status: "unavailable", reason: "not_worn" } });
eq("null active with wear", classifyDailyEnergy({ ...en, date: "2026-07-04", totalCaloriesKcal: 2100, activeCaloriesKcal: null, hasWearEvidence: true }),
  { total: { status: "measured", kcal: 2100, partialDay: false }, active: { status: "unavailable", reason: "not_supported" } });
eq("normal day", classifyDailyEnergy({ ...en, date: "2026-11-10", totalCaloriesKcal: 2381.4, activeCaloriesKcal: 463, hasWearEvidence: true }),
  { total: { status: "measured", kcal: 2381.4, partialDay: false }, active: { status: "measured", kcal: 463, partialDay: false } });
eq("today partial", classifyDailyEnergy({ ...en, date: "2026-11-12", totalCaloriesKcal: 1035, activeCaloriesKcal: 252, hasWearEvidence: false }),
  { total: { status: "measured", kcal: 1035, partialDay: true }, active: { status: "measured", kcal: 252, partialDay: true } });
eq("today null active stays partial", classifyDailyEnergy({ ...en, date: "2026-11-12", totalCaloriesKcal: 1035, activeCaloriesKcal: null, hasWearEvidence: false }),
  { total: { status: "measured", kcal: 1035, partialDay: true }, active: { status: "unavailable", reason: "partial_day" } });
eq("synced, no row", classifyDailyEnergy({ ...en, date: "2026-11-09", totalCaloriesKcal: null, activeCaloriesKcal: null, hasWearEvidence: false }).total,
  { status: "unavailable", reason: "not_worn" });
eq("not synced", classifyDailyEnergy({ today: "2026-11-12", synced: false, date: "2026-01-05", totalCaloriesKcal: null, activeCaloriesKcal: null, hasWearEvidence: false }),
  { total: { status: "unavailable", reason: "not_synced" }, active: { status: "unavailable", reason: "not_synced" } });

// Review additions: summer midnight crossing (+01:00), offset change mid-session, zero active time, HR boundaries.
const summerCross = buildWorkout(W({
  id: "sc", exerciseDate: "2026-07-14",
  startMs: Date.parse("2026-07-14T22:30:00Z"), endMs: Date.parse("2026-07-14T23:30:00Z"),
  startUtcOffsetSeconds: 3600, endUtcOffsetSeconds: 3600,
}));
eq("summer cross start", summerCross.startLocal, "2026-07-14T23:30:00+01:00");
eq("summer cross end", summerCross.endLocal, "2026-07-15T00:30:00+01:00");
eq("summer cross flags", [summerCross.date, summerCross.endDate, summerCross.crossesMidnight], ["2026-07-14", "2026-07-15", true]);
const offsetChange = buildWorkout(W({
  exerciseDate: "2026-10-25",
  startMs: Date.parse("2026-10-25T00:30:00Z"), endMs: Date.parse("2026-10-25T01:30:00Z"),
  startUtcOffsetSeconds: 3600, endUtcOffsetSeconds: 0,
}));
eq("offset change", [offsetChange.startLocal, offsetChange.endLocal], ["2026-10-25T01:30:00+01:00", "2026-10-25T01:30:00+00:00"]);
const zeroActive = buildWorkout(W({ activeDurationSeconds: 0, distanceMeters: 500 }));
eq("zero active no pace", [zeroActive.speedKmh, zeroActive.paceSecondsPerKm], [null, null]);
const edge = buildWorkout(W({ hrSamples: [{ tMs: Date.parse("2026-11-04T18:35:29Z"), bpm: 80 }, { tMs: Date.parse("2026-11-04T19:01:06Z"), bpm: 100 }] }));
eq("hr boundaries inclusive", edge.heartRate?.sampleCount, 2);
eq("pair manual survives", pair.find((p) => p.id === "manual")?.recordingMethod, { kind: "manual", raw: "MANUAL" });

console.log("exercise fixture ok");
