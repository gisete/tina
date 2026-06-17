/**
 * Fixture tests for calculateStageHr.
 * Run: npx tsx scripts/test-stage-hr.ts
 */
import { calculateStageHr } from "../src/lib/analytics/sleep/stage-hr";
import type { SleepStageInterval } from "../src/lib/analytics/sleep/types";

let pass = 0;
let fail = 0;

function assert(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}

// ---------------------------------------------------------------------------
// Shared timeline: two stages, each 10 minutes
// ---------------------------------------------------------------------------
// deep:  [0ms, 600_000ms)
// light: [600_000ms, 1_200_000ms)
const T0 = 0;
const TIMELINE: SleepStageInterval[] = [
  {
    stageType: "deep",
    startTime: new Date(T0).toISOString(),
    endTime:   new Date(T0 + 600_000).toISOString(),
    durationMs: 600_000,
  },
  {
    stageType: "light",
    startTime: new Date(T0 + 600_000).toISOString(),
    endTime:   new Date(T0 + 1_200_000).toISOString(),
    durationMs: 600_000,
  },
];

// ---------------------------------------------------------------------------
// (a) Per-stage averages — each stage matches hand-calc; out-of-stage ignored
// ---------------------------------------------------------------------------
console.log("\n(a) Per-stage averages");
{
  const samples = [
    { timestamp: T0 + 100_000, bpm: 50 },   // deep
    { timestamp: T0 + 200_000, bpm: 54 },   // deep
    { timestamp: T0 + 700_000, bpm: 60 },   // light
    { timestamp: T0 + 800_000, bpm: 62 },   // light
    { timestamp: T0 + 800_000, bpm: 64 },   // light (third sample)
    { timestamp: T0 + 1_500_000, bpm: 99 }, // outside any interval — must be excluded
  ];
  const result = calculateStageHr(samples, TIMELINE);

  assert("deep avgBpm = round((50+54)/2) = 52", result.deep.avgBpm, 52);
  assert("deep sampleCount = 2", result.deep.sampleCount, 2);
  assert("light avgBpm = round((60+62+64)/3) = 62", result.light.avgBpm, 62);
  assert("light sampleCount = 3", result.light.sampleCount, 3);
  assert("rem avgBpm = null (no samples)", result.rem.avgBpm, null);
  assert("rem sampleCount = 0", result.rem.sampleCount, 0);
  assert("awake avgBpm = null (no samples)", result.awake.avgBpm, null);
}

// ---------------------------------------------------------------------------
// (b) Stage with no samples returns null avgBpm and sampleCount 0
// ---------------------------------------------------------------------------
console.log("\n(b) Stage with no samples → null");
{
  const samples = [{ timestamp: T0 + 100_000, bpm: 55 }]; // deep only
  const result = calculateStageHr(samples, TIMELINE);

  assert("deep avgBpm = 55", result.deep.avgBpm, 55);
  assert("light avgBpm = null", result.light.avgBpm, null);
  assert("light sampleCount = 0", result.light.sampleCount, 0);
}

// ---------------------------------------------------------------------------
// (c) Boundary sample: exactly at startMs of light → assigned to light, not deep
//     (half-open [start, end): deep ends at 600_000, light starts at 600_000)
// ---------------------------------------------------------------------------
console.log("\n(c) Boundary sample assigned to exactly one stage (no double-count)");
{
  const samples = [{ timestamp: T0 + 600_000, bpm: 70 }]; // exactly on deep/light boundary
  const result = calculateStageHr(samples, TIMELINE);

  // Intervals are in order [deep, light]. deep=[0,600k), light=[600k,1200k).
  // 600k < 600k is false → deep does NOT match.
  // 600k >= 600k AND 600k < 1200k → light matches.
  assert("boundary at 600_000 lands in light, not deep", result.light.avgBpm, 70);
  assert("deep has no sample for boundary timestamp", result.deep.avgBpm, null);
  assert("total samples = 1 (no double-count)", result.deep.sampleCount + result.light.sampleCount, 1);
}

// ---------------------------------------------------------------------------
// (d) Empty inputs
// ---------------------------------------------------------------------------
console.log("\n(d) Empty inputs");
{
  const empty = calculateStageHr([], TIMELINE);
  assert("empty samples → deep null", empty.deep.avgBpm, null);
  assert("empty timeline → no crash", calculateStageHr([{ timestamp: 0, bpm: 60 }], []).deep.avgBpm, null);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
