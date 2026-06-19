// Fixture tests for aggregateZoneMinutes and calculateActiveZoneMinutes.
// Run with: npx tsx src/lib/analytics/activity.fixture.ts

import { aggregateZoneMinutes, calculateActiveZoneMinutes } from "./activity";
import type { ZoneRecord } from "./activity";

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual  : ${JSON.stringify(actual)}`);
    failed++;
  }
}

// --- aggregateZoneMinutes ---
console.log("aggregateZoneMinutes");

const mixedRecords: ZoneRecord[] = [
  { zoneType: "LIGHT",    civilDate: "2026-06-18", durationMinutes: 30 },
  { zoneType: "MODERATE", civilDate: "2026-06-18", durationMinutes: 10 },
  { zoneType: "VIGOROUS", civilDate: "2026-06-18", durationMinutes: 5  },
  { zoneType: "PEAK",     civilDate: "2026-06-18", durationMinutes: 2  },
];

assert(
  "sums each zone correctly",
  aggregateZoneMinutes(mixedRecords),
  { light: 30, moderate: 10, vigorous: 5, peak: 2 },
);

assert(
  "empty input → all zeros",
  aggregateZoneMinutes([]),
  { light: 0, moderate: 0, vigorous: 0, peak: 0 },
);

const multiMinuteRecord: ZoneRecord[] = [
  { zoneType: "MODERATE", civilDate: "2026-06-18", durationMinutes: 3 },
  { zoneType: "MODERATE", civilDate: "2026-06-18", durationMinutes: 7 },
];
assert(
  "accumulates multiple same-zone records",
  aggregateZoneMinutes(multiMinuteRecord),
  { light: 0, moderate: 10, vigorous: 0, peak: 0 },
);

// --- calculateActiveZoneMinutes ---
console.log("calculateActiveZoneMinutes");

// User-spec fixture: {moderate:10, vigorous:5, peak:2} -> 10*1 + 5*2 + 2*2 = 24
assert(
  "spec fixture: moderate=10 vigorous=5 peak=2 → 24",
  calculateActiveZoneMinutes({ light: 0, moderate: 10, vigorous: 5, peak: 2 }),
  24,
);

assert(
  "LIGHT contributes 0 AZM",
  calculateActiveZoneMinutes({ light: 60, moderate: 0, vigorous: 0, peak: 0 }),
  0,
);

assert(
  "VIGOROUS and PEAK both weight ×2",
  calculateActiveZoneMinutes({ light: 0, moderate: 0, vigorous: 10, peak: 10 }),
  40,
);

assert(
  "all zeros → 0",
  calculateActiveZoneMinutes({ light: 0, moderate: 0, vigorous: 0, peak: 0 }),
  0,
);

// Combines both functions
const aggregated = aggregateZoneMinutes(mixedRecords);
assert(
  "pipeline: aggregate then calculate → 10*1 + 5*2 + 2*2 = 24",
  calculateActiveZoneMinutes(aggregated),
  24,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
