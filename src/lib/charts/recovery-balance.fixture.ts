// npx tsx src/lib/charts/recovery-balance.fixture.ts
import { buildRecoveryBalanceGeometry } from "./recovery-balance";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

// ---------------------------------------------------------------------------
// (a) Known z-series: verify symmetric domain and spot-check point coordinates.
// ---------------------------------------------------------------------------

// rhrPoints = [null, 1.5, 0.0, -0.5, null]
// hrvPoints = [0.5, -0.5, 0.0, 1.0, -1.0]
// maxAbs = 1.5 → ceil(1.5 + 0.5) = 2 → bound = max(2, 2) = 2
const rhrPoints: (number | null)[] = [null, 1.5, 0.0, -0.5, null];
const hrvPoints: (number | null)[] = [0.5, -0.5, 0.0, 1.0, -1.0];

const geo = buildRecoveryBalanceGeometry(rhrPoints, hrvPoints);

assert(geo.yMax ===  2, `yMax = 2, got ${geo.yMax}`);
assert(geo.yMin === -2, `yMin = -2, got ${geo.yMin}`);
assert(near(geo.zeroYFrac, 0.5), `zeroYFrac = 0.5, got ${geo.zeroYFrac}`);

// y-ticks: integers -2..+2 → 5 entries
assert(geo.yTicks.length === 5, `yTicks.length = 5, got ${geo.yTicks.length}`);
assert(geo.yTicks[0].z === -2 && near(geo.yTicks[0].yFrac, 1.0), "bottom tick: z=-2, yFrac=1");
assert(geo.yTicks[4].z ===  2 && near(geo.yTicks[4].yFrac, 0.0), "top tick: z=+2, yFrac=0");
assert(geo.yTicks[2].z ===  0 && near(geo.yTicks[2].yFrac, 0.5), "mid tick: z=0, yFrac=0.5");

// n=5 → xFrac(i) = i/4
// rhrPoints[1] = 1.5 at i=1: xFrac=0.25, yFrac=(2-1.5)/4=0.125
const rhrSeg0 = geo.rhrSegments[0]; // indices 1,2,3 are the one contiguous run
assert(geo.rhrSegments.length === 1, `rhrSegments.length = 1, got ${geo.rhrSegments.length}`);
assert(rhrSeg0.length === 3, `rhrSeg0.length = 3, got ${rhrSeg0.length}`);
assert(near(rhrSeg0[0].xFrac, 0.25),   `rhrSeg0[0].xFrac = 0.25, got ${rhrSeg0[0].xFrac}`);
assert(near(rhrSeg0[0].yFrac, 0.125),  `rhrSeg0[0].yFrac = 0.125 (z=1.5), got ${rhrSeg0[0].yFrac}`);
assert(near(rhrSeg0[1].xFrac, 0.5),    `rhrSeg0[1].xFrac = 0.5, got ${rhrSeg0[1].xFrac}`);
assert(near(rhrSeg0[1].yFrac, 0.5),    `rhrSeg0[1].yFrac = 0.5 (z=0), got ${rhrSeg0[1].yFrac}`);
assert(near(rhrSeg0[2].xFrac, 0.75),   `rhrSeg0[2].xFrac = 0.75, got ${rhrSeg0[2].xFrac}`);
assert(near(rhrSeg0[2].yFrac, 0.625),  `rhrSeg0[2].yFrac = 0.625 (z=-0.5), got ${rhrSeg0[2].yFrac}`);

// HRV: all 5 non-null → one segment with 5 points
assert(geo.hrvSegments.length === 1,         "hrvSegments.length = 1 (no gaps)");
assert(geo.hrvSegments[0].length === 5,      "hrvSeg0.length = 5");

// Markers: nulls excluded
assert(geo.rhrMarkers.length === 3, `rhrMarkers.length = 3, got ${geo.rhrMarkers.length}`);
assert(geo.hrvMarkers.length === 5, `hrvMarkers.length = 5, got ${geo.hrvMarkers.length}`);

// ---------------------------------------------------------------------------
// (b) All-null series — domain collapses to minimum span ±2.
// ---------------------------------------------------------------------------

const nullGeo = buildRecoveryBalanceGeometry([null, null, null], [null, null, null]);
assert(nullGeo.yMax >=  2, `all-null: yMax >= 2, got ${nullGeo.yMax}`);
assert(nullGeo.yMin <= -2, `all-null: yMin <= -2, got ${nullGeo.yMin}`);
assert(nullGeo.rhrSegments.length === 0, "all-null: no segments");
assert(nullGeo.rhrMarkers.length   === 0, "all-null: no markers");

// ---------------------------------------------------------------------------
// (c) Flat (all-zero) series — domain still holds minimum span ±2.
// ---------------------------------------------------------------------------

const flatGeo = buildRecoveryBalanceGeometry([0, 0, 0], [0, 0, 0]);
assert(flatGeo.yMax ===  2, `flat: yMax = 2, got ${flatGeo.yMax}`);
assert(flatGeo.yMin === -2, `flat: yMin = -2, got ${flatGeo.yMin}`);

// ---------------------------------------------------------------------------
// (d) Large z-score — domain fits + rounds up to nearest integer.
// ---------------------------------------------------------------------------

// maxAbs = 2.7 → ceil(2.7 + 0.5) = ceil(3.2) = 4 → bound = max(4, 2) = 4
const largeGeo = buildRecoveryBalanceGeometry([2.7, -1.0], [0.5, 0.0]);
assert(largeGeo.yMax === 4, `large: yMax = 4, got ${largeGeo.yMax}`);
assert(largeGeo.yMin === -4, `large: yMin = -4, got ${largeGeo.yMin}`);
assert(largeGeo.yTicks.length === 9, `large: 9 ticks (-4..+4), got ${largeGeo.yTicks.length}`);

// ---------------------------------------------------------------------------

console.log("All assertions passed.");
