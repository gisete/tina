/**
 * Spot-checks for the nightOf() helper — run with:
 *   npx tsx scripts/sleep-date-spot-check.ts
 */

import { nightOf } from "../src/lib/google/normalizers";

let pass = 0;
let fail = 0;

function check(label: string, got: string, expected: string) {
  if (got === expected) {
    console.log(`  ✓  ${label}`);
    pass++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected ${expected}`);
    console.error(`       got      ${got}`);
    fail++;
  }
}

// (a) UTC+1 evening — 22:29 local, hour ≥ 18 → stays on the same date
check(
  "22:29Z + 3600s → 2026-06-11 (unchanged, evening start)",
  nightOf(new Date("2026-06-11T22:29:00Z").getTime(), 3600),
  "2026-06-11",
);

// (b) THE BUG CASE — UTC+1, session started at 01:06 local on June 13
//     → hour 1 < 18 → keyed to the previous evening: June 12
check(
  "00:06Z + 3600s → 2026-06-12 (midnight-crossing, bug case)",
  nightOf(new Date("2026-06-13T00:06:00Z").getTime(), 3600),
  "2026-06-12",
);

// (c) UTC+10 evening — 11:00Z = 21:00 local, hour ≥ 18 → stays on same date
check(
  "11:00Z + 36000s → 2026-06-08 (UTC+10 evening, no shift)",
  nightOf(new Date("2026-06-08T11:00:00Z").getTime(), 36000),
  "2026-06-08",
);

// (d) UTC early-morning no offset — pure UTC, hour < 18 → previous day
check(
  "05:00Z + 0s → 2026-06-07 (UTC early-morning, shift back)",
  nightOf(new Date("2026-06-08T05:00:00Z").getTime(), 0),
  "2026-06-07",
);

// (e) Month/year boundary rollover — Jan 1 early morning UTC+1
//     00:30Z + 3600s = 01:30 local Jan 1 → previous night = Dec 31
check(
  "2026-01-01T00:30Z + 3600s → 2025-12-31 (year rollover)",
  nightOf(new Date("2026-01-01T00:30:00Z").getTime(), 3600),
  "2025-12-31",
);

// (f) Exactly at boundary — 18:00 local is NOT before 18, so no shift
check(
  "17:00Z + 3600s → 2026-06-11 (18:00 local exact boundary, no shift)",
  nightOf(new Date("2026-06-11T17:00:00Z").getTime(), 3600),
  "2026-06-11",
);

// (g) Negative offset — UTC-5, 03:00 local = 08:00 UTC
//     local hour 3 < 18 → shift back
check(
  "08:00Z + (-18000s) → 2026-06-10 (UTC-5 early morning, shift back)",
  nightOf(new Date("2026-06-11T08:00:00Z").getTime(), -18000),
  "2026-06-10",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
