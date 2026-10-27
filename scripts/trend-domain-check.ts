// Spot-check: run with `npx tsx scripts/trend-domain-check.ts`
import assert from "node:assert/strict";
import { fitDomain, SLEEP_SCORE_DOMAIN } from "@/lib/charts/trend-domain";

/** The original Sleep Score Trend function, verbatim, as the reference. */
function fittedDomainOld(min: number | null, max: number | null): [number, number] {
  if (min === null || max === null) return [0, 100];
  const lo = Math.max(0,   Math.floor((min - 5) / 5) * 5);
  const hi = Math.min(100, Math.ceil((max  + 5) / 5) * 5);
  return [lo, hi === lo ? lo + 10 : hi];
}

// 1. Sleep options reproduce the old function for every min <= max in 0..100 (steps of 0.5).
let pairs = 0;
for (let a = 0; a <= 200; a++) {
  for (let b = a; b <= 200; b++) {
    const min = a / 2, max = b / 2;
    assert.deepEqual(fitDomain(min, max, SLEEP_SCORE_DOMAIN), fittedDomainOld(min, max), `min ${min} max ${max}`);
    pairs++;
  }
}
assert.deepEqual(fitDomain(null, null, SLEEP_SCORE_DOMAIN), [0, 100]);
assert.deepEqual(fitDomain(50, null, SLEEP_SCORE_DOMAIN), [0, 100]);
console.log(`1 sleep options == old function over ${pairs} min/max pairs`);

// 2. Heart-style options: pad 10% of range is the caller's job; floor 0, no ceiling, min span 10.
const hr = { pad: 2, step: 5, minSpan: 10, floor: 0 };
assert.deepEqual(fitDomain(68, 72, hr), [65, 75]);        // flat-ish data: span 10 already
assert.deepEqual(fitDomain(70, 70, hr), [65, 75]);        // single value: widened to the minimum span
assert.deepEqual(fitDomain(66, 74, hr), [60, 80]);        // pad pushes outward to the next step
assert.deepEqual(fitDomain(2, 3, hr), [0, 10]);           // floor bites: remainder moves to the top
assert.deepEqual(fitDomain(15, 90, { pad: 8, step: 5, minSpan: 10, floor: 0 }), [5, 100]); // no ceiling
assert.deepEqual(fitDomain(null, null, hr), [0, 100]);
assert.deepEqual(fitDomain(null, null, { ...hr, empty: [0, 10] }), [0, 10]);
// min span rounds up to whole steps: 12 -> 15
assert.deepEqual(fitDomain(70, 70, { pad: 0, step: 5, minSpan: 12 }), [65, 80]);
// Result always covers the data and respects the span and clamps.
for (const [mn, mx] of [[0, 0], [1, 4], [40, 41], [68, 72], [99, 100], [20, 95]] as const) {
  const [lo, hi] = fitDomain(mn, mx, { pad: 1, step: 5, minSpan: 10, floor: 0, ceil: 100 });
  assert.ok(lo <= mn && hi >= mx && hi - lo >= 10 && lo >= 0 && hi <= 100, `${mn}..${mx} -> ${lo}..${hi}`);
}
console.log("2 generalized options ok");
console.log("ALL CHECKS PASSED");
