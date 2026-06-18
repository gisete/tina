// npx tsx src/lib/analytics/hr-trends.fixture.ts
import { standardizeRecoverySeries, MIN_BASELINE_NIGHTS } from "./hr-trends";
import { addDays } from "../dates";
import type { DailyHrSummary } from "./hr-trends";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Use a fixed anchor date and local-timezone addDays — consistent with engine.
const ANCHOR = "2026-01-01";

// Build 90-night baseline: RHR=60, HRV=40 on all nights.
const summaries: DailyHrSummary[] = Array.from({ length: 90 }, (_, i) => ({
  date: addDays(ANCHOR, i),
  restingHeartRate: 60,
  hrv: 40,
}));

// Patch outlier nights to known z-scoreable values.
summaries[89] = { ...summaries[89], restingHeartRate: 70 }; // last night — RHR outlier
summaries[0]  = { ...summaries[0],  hrv: 50 };              // first night — HRV outlier

const windowStart = summaries[0].date;
const windowEnd   = summaries[89].date;

// ---------------------------------------------------------------------------
// (a) Spot-check z-scores on known outlier nights.
// ---------------------------------------------------------------------------

const result = standardizeRecoverySeries(summaries, windowStart, windowEnd);

// RHR: 89 nights at 60 + 1 night at 70 → nights=90
const rhrMean = (89 * 60 + 70) / 90;
const rhrVar  = (89 * (60 - rhrMean) ** 2 + (70 - rhrMean) ** 2) / 90;
const rhrStd  = Math.sqrt(rhrVar);
const expectedRhrZ89 = (70 - rhrMean) / rhrStd;

assert(result.rhr.baselineReady, "rhr baselineReady");
assert(result.rhr.nights === 90, `rhr nights = 90, got ${result.rhr.nights}`);
const actualRhrZ89 = result.rhr.points[89];
assert(actualRhrZ89 !== null && actualRhrZ89 !== undefined, "rhrZ[89] is not null/undefined");
assert(
  Math.abs((actualRhrZ89 as number) - expectedRhrZ89) < 1e-9,
  `rhrZ[89] = ${round2(actualRhrZ89 as number)}, expected ${round2(expectedRhrZ89)}`,
);

// HRV: 89 nights at 40 + 1 night at 50 → nights=90
const hrvMean = (89 * 40 + 50) / 90;
const hrvVar  = (89 * (40 - hrvMean) ** 2 + (50 - hrvMean) ** 2) / 90;
const hrvStd  = Math.sqrt(hrvVar);
const expectedHrvZ0 = (50 - hrvMean) / hrvStd;

assert(result.hrv.baselineReady, "hrv baselineReady");
assert(result.hrv.nights === 90, `hrv nights = 90, got ${result.hrv.nights}`);
const actualHrvZ0 = result.hrv.points[0];
assert(actualHrvZ0 !== null && actualHrvZ0 !== undefined, "hrvZ[0] is not null/undefined");
assert(
  Math.abs((actualHrvZ0 as number) - expectedHrvZ0) < 1e-9,
  `hrvZ[0] = ${round2(actualHrvZ0 as number)}, expected ${round2(expectedHrvZ0)}`,
);

// ---------------------------------------------------------------------------
// (b) Nulls preserved — a night with null values stays null in the z-series.
// ---------------------------------------------------------------------------

const withNull: DailyHrSummary[] = summaries.map((s, i) =>
  i === 50 ? { ...s, restingHeartRate: null, hrv: null } : s,
);
const resultNull = standardizeRecoverySeries(withNull, windowStart, windowEnd);
assert(resultNull.rhr.points[50] === null, "null RHR night preserved as null z-score");
assert(resultNull.hrv.points[50] === null, "null HRV night preserved as null z-score");

// ---------------------------------------------------------------------------
// (c) std = 0 (all identical) → all-null + baselineReady: false.
// ---------------------------------------------------------------------------

const constantRhr: DailyHrSummary[] = summaries.map((s) => ({
  ...s,
  restingHeartRate: 60,
}));
const resultConst = standardizeRecoverySeries(constantRhr, windowStart, windowEnd);
assert(!resultConst.rhr.baselineReady, "constant RHR: baselineReady = false");
assert(
  resultConst.rhr.points.every((p) => p === null),
  "constant RHR: all points are null",
);

// ---------------------------------------------------------------------------
// (d) Fewer than MIN_BASELINE_NIGHTS non-null nights → baselineReady: false.
// ---------------------------------------------------------------------------

const fewNights: DailyHrSummary[] = Array.from(
  { length: MIN_BASELINE_NIGHTS - 1 },
  (_, i) => ({ date: addDays(ANCHOR, i), restingHeartRate: 60, hrv: 40 }),
);
const fewStart  = fewNights[0].date;
const fewEnd    = fewNights[fewNights.length - 1].date;
const resultFew = standardizeRecoverySeries(fewNights, fewStart, fewEnd);
assert(!resultFew.rhr.baselineReady, `<${MIN_BASELINE_NIGHTS} nights → rhr.baselineReady = false`);
assert(!resultFew.hrv.baselineReady, `<${MIN_BASELINE_NIGHTS} nights → hrv.baselineReady = false`);

// ---------------------------------------------------------------------------

console.log("All assertions passed.");
console.log(`  rhrZ[89] (outlier) = ${round2(actualRhrZ89 as number)} σ  (expected ${round2(expectedRhrZ89)} σ)`);
console.log(`  hrvZ[0]  (outlier) = ${round2(actualHrvZ0 as number)} σ  (expected ${round2(expectedHrvZ0)} σ)`);
