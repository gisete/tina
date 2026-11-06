// npx tsx src/lib/google/exercise-normalizers.fixture.ts
import {
  civilDateAtOffset,
  normalizeDailyEnergy,
  normalizeExercisePoint,
  normalizeExercisePoints,
  parseDurationSeconds,
  type GoogleExercisePoint,
} from "./exercise-normalizers";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

const base = (over: Partial<NonNullable<GoogleExercisePoint["exercise"]>>, id = "1", method = "ACTIVELY_MEASURED"): GoogleExercisePoint => ({
  name: `users/9/dataTypes/exercise/dataPoints/${id}`,
  dataSource: { recordingMethod: method },
  exercise: {
    interval: { startTime: "2026-11-04T18:35:29Z", startUtcOffset: "0s", endTime: "2026-11-04T19:01:06Z", endUtcOffset: "0s" },
    exerciseType: "WALKING",
    displayName: "Walk",
    activeDuration: "1536s",
    metricsSummary: {
      caloriesKcal: 159,
      distanceMillimeters: 1587445,
      steps: "2452",
      averagePaceSecondsPerMeter: 0.96,
      averageHeartRateBeatsPerMinute: "99",
      activeZoneMinutes: "6",
      heartRateZoneDurations: { lightTime: "1560s", moderateTime: "0s", vigorousTime: "0s", peakTime: "0s" },
    },
    ...over,
  },
});

// Paused workout: active duration (942 s) is shorter than elapsed (1389 s). Stored as given, never end - start.
const paused = normalizeExercisePoint(base({
  interval: { startTime: "2026-10-23T14:04:00Z", startUtcOffset: "3600s", endTime: "2026-10-23T14:27:09Z", endUtcOffset: "3600s" },
  activeDuration: "942s",
}));
assert(paused !== null, "paused workout normalizes");
assert(paused!.activeDurationSeconds === 942, "active duration is Google's, not end minus start");
assert(paused!.endTime.getTime() - paused!.startTime.getTime() === 1389_000, "elapsed is 1389 s");

// Local midnight: 23:50 local (offset +1h) is the 22:50Z start and belongs to the START date.
const cross = normalizeExercisePoint(base({
  interval: { startTime: "2026-10-04T22:50:00Z", startUtcOffset: "3600s", endTime: "2026-10-04T23:40:00Z", endUtcOffset: "3600s" },
}));
assert(cross!.exerciseDate === "2026-10-04", "22:50Z at +1h is 23:50 local on the 4th");
// Same instant, offset +9h: already the next calendar day.
assert(civilDateAtOffset(Date.parse("2026-10-04T22:50:00Z"), 32400) === "2026-10-05", "+9h pushes the local date to the 5th");
// Early morning local, no night shift: 00:30 local stays on its own calendar day.
assert(civilDateAtOffset(Date.parse("2026-10-05T23:30:00Z"), 3600) === "2026-10-06", "00:30 local belongs to the 6th (no night boundary)");

// Strength training: no distance, steps or pace -> null, not 0.
const strength = normalizeExercisePoint(base({
  exerciseType: "STRENGTH_TRAINING",
  metricsSummary: { caloriesKcal: 243, averageHeartRateBeatsPerMinute: "93", heartRateZoneDurations: { lightTime: "2280s", moderateTime: "0s", vigorousTime: "0s", peakTime: "0s" } },
}));
assert(strength!.distanceMeters === null && strength!.steps === null && strength!.avgPaceSecondsPerMeter === null, "absent distance/steps/pace are null");
assert(strength!.activeZoneMinutes === null, "absent AZM is null");
assert(strength!.moderateZoneSeconds === 0, "a real 0s zone duration stays 0");

// Distance reported as 0 for a non-distance activity is kept as a measured 0 (the engine decides what it means).
const zeroDist = normalizeExercisePoint(base({ metricsSummary: { caloriesKcal: 100, distanceMillimeters: 0 } }));
assert(zeroDist!.distanceMeters === 0, "distance 0 stays 0");

// Whole zone-durations object absent -> all four null, never 0.
const noZones = normalizeExercisePoint(base({ metricsSummary: { caloriesKcal: 100 } }));
assert(
  noZones!.lightZoneSeconds === null && noZones!.moderateZoneSeconds === null && noZones!.vigorousZoneSeconds === null && noZones!.peakZoneSeconds === null,
  "missing heartRateZoneDurations gives four nulls",
);

// Unit conversion and parsing.
const walk = normalizeExercisePoint(base({}));
assert(walk!.distanceMeters === 1587.445, "millimeters -> meters");
assert(walk!.steps === 2452 && walk!.avgHeartRateBpm === 99 && walk!.activeZoneMinutes === 6, "int64 strings parse");
assert(walk!.googleDataPointId === "1" && walk!.recordingMethod === "ACTIVELY_MEASURED", "id is the last name segment");
assert(parseDurationSeconds("1560s") === 1560 && parseDurationSeconds("x") === null && parseDurationSeconds(undefined) === null, "duration parsing");

// Manual and passive sessions are kept (filtering is a UI concern).
const manual = normalizeExercisePoint(base({}, "2", "MANUAL"));
assert(manual!.recordingMethod === "MANUAL", "manual recording method kept");

// Required fields missing -> skipped and counted; duplicates collapse by id; sorted ascending.
const bad: GoogleExercisePoint = { name: "users/9/dataTypes/exercise/dataPoints/3", dataSource: { recordingMethod: "MANUAL" }, exercise: { exerciseType: "WALKING" } };
const later = base({ interval: { startTime: "2026-11-05T08:00:00Z", startUtcOffset: "0s", endTime: "2026-11-05T08:30:00Z", endUtcOffset: "0s" } }, "9");
const batch = normalizeExercisePoints([later, base({}), base({}), bad]);
assert(batch.sessions.length === 2 && batch.skipped === 1, "one bad point skipped, duplicate collapsed");
assert(batch.sessions[0].googleDataPointId === "1" && batch.sessions[1].googleDataPointId === "9", "sorted by start time");

// Daily energy merge: a day in one rollup only keeps the other column null.
const d = (day: number) => ({ civilStartTime: { date: { year: 2026, month: 11, day } } });
const energy = normalizeDailyEnergy(
  [{ ...d(3), totalCalories: { kcalSum: 2400.5 } }, { ...d(4), totalCalories: { kcalSum: 2571.8 } }],
  [{ ...d(4), activeEnergyBurned: { kcalSum: 637.7 } }, { ...d(5), activeEnergyBurned: { kcalSum: 100 } }],
);
assert(energy.length === 3, "three distinct days");
assert(energy[0].energyDate === "2026-11-03" && energy[0].totalCaloriesKcal === 2400.5 && energy[0].activeCaloriesKcal === null, "total-only day");
assert(energy[1].totalCaloriesKcal === 2571.8 && energy[1].activeCaloriesKcal === 637.7, "both present");
assert(energy[2].totalCaloriesKcal === null && energy[2].activeCaloriesKcal === 100, "active-only day");

console.log("exercise-normalizers fixture: ok");
