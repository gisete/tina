// npx tsx src/lib/sync/workout-samples.fixture.ts
import { excludeSamplesInWindows } from "./workout-samples";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

const at = (iso: string): Date => new Date(iso);
const sample = (iso: string, bpm = 70) => ({ timestamp: at(iso), bpm });

// A night ending 08:00Z. A workout 07:50Z..08:30Z overlaps the night's end by
// 10 minutes. Samples every 5 minutes across the workout window.
const night = { start: at("2026-10-15T00:00:00Z"), end: at("2026-10-15T08:00:00Z") };
const workoutSamples = [
  sample("2026-10-15T07:50:00Z"),
  sample("2026-10-15T07:55:00Z"),
  sample("2026-10-15T08:00:00Z"), // exactly the night's end: inside (closed interval)
  sample("2026-10-15T08:05:00Z"),
  sample("2026-10-15T08:10:00Z"),
  sample("2026-10-15T08:30:00Z"),
];

const kept = excludeSamplesInWindows(workoutSamples, [night]);
assert(kept.length === 3, `only the 3 non-overlapping samples are stored, got ${kept.length}`);
assert(kept[0].timestamp.toISOString() === "2026-10-15T08:05:00.000Z", "first kept sample is 08:05Z");
assert(kept.every((s) => s.timestamp.getTime() > night.end.getTime()), "no kept sample is inside the night");

// No overlap: everything is kept, same array contents.
const apart = excludeSamplesInWindows(workoutSamples, [{ start: at("2026-10-14T00:00:00Z"), end: at("2026-10-14T08:00:00Z") }]);
assert(apart.length === workoutSamples.length, "a non-overlapping night removes nothing");

// No windows at all.
assert(excludeSamplesInWindows(workoutSamples, []).length === 6, "no windows removes nothing");

// Workout fully inside a nap window: nothing stored.
const nap = { start: at("2026-10-15T07:00:00Z"), end: at("2026-10-15T09:00:00Z") };
assert(excludeSamplesInWindows(workoutSamples, [nap]).length === 0, "a workout inside a session window stores nothing");

// Two windows (night + nap) both apply; the workout's start before the night's start is kept.
const early = [sample("2026-10-14T23:59:00Z"), sample("2026-10-15T00:00:00Z"), sample("2026-10-15T00:01:00Z")];
const two = excludeSamplesInWindows(early, [night, nap]);
assert(two.length === 1 && two[0].timestamp.toISOString() === "2026-10-14T23:59:00.000Z", "start boundary is inclusive, earlier sample kept");

// Does not mutate its input.
assert(workoutSamples.length === 6, "input is not mutated");

console.log("workout-samples fixture: ok");
