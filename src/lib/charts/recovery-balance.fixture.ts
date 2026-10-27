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

// ---------------------------------------------------------------------------
// (c) Gap bridges and both-absent ticks.
// ---------------------------------------------------------------------------

{
  const N = null;
  // Gap in ONE series only: RHR has an interior gap (idx 2), HRV is complete.
  const g1 = buildRecoveryBalanceGeometry([1, 0.5, N, -0.5, 0], [0, 1, 0, -1, 0]);
  assert(g1.rhrBridges.length === 1, "one-series gap: one RHR bridge");
  assert(g1.hrvBridges.length === 0, "one-series gap: HRV has none");
  assert(g1.rhrBridges[0].fromIndex === 1 && g1.rhrBridges[0].toIndex === 3, "bridge joins idx 1 -> 3");
  assert(near(g1.rhrBridges[0].from.xFrac, g1.xFracs[1]) && near(g1.rhrBridges[0].to.xFrac, g1.xFracs[3]), "bridge x ends on the real points");
  // Same yFrac math as the solid run: the bridge ends coincide with the segment points.
  assert(near(g1.rhrBridges[0].from.yFrac, g1.rhrSegments[0][1].yFrac), "bridge start == end of first run");
  assert(near(g1.rhrBridges[0].to.yFrac, g1.rhrSegments[1][0].yFrac), "bridge end == start of next run");
  assert(g1.bothAbsentIndices.length === 0, "one metric present every day: no ticks");

  // Gaps in BOTH series; idx 2 absent in both, idx 4 only RHR, idx 5 only HRV.
  const g2 = buildRecoveryBalanceGeometry([1, 0.5, N, 0.2, N, 1, 0], [0, 1, N, 0, 1, N, 0]);
  assert(g2.rhrBridges.length === 2 && g2.hrvBridges.length === 2, "gaps in both: two bridges each");
  assert(JSON.stringify(g2.bothAbsentIndices) === "[2]", `ticks only where both absent, got ${JSON.stringify(g2.bothAbsentIndices)}`);

  // Gap touching the window edge: leading and trailing nulls get no bridge, no extrapolation.
  const g3 = buildRecoveryBalanceGeometry([N, N, 1, 0.5, N], [0, N, N, 1, 1]);
  assert(g3.rhrBridges.length === 0, "edge gaps: no RHR bridge");
  assert(g3.hrvBridges.length === 1 && g3.hrvBridges[0].fromIndex === 0 && g3.hrvBridges[0].toIndex === 3, "HRV interior gap bridged");
  assert(JSON.stringify(g3.bothAbsentIndices) === "[1]", "both absent only at idx 1");

  // A series with no baseline is all-null: no bridges, and it never forces a tick.
  const g4 = buildRecoveryBalanceGeometry([N, N, N, N], [1, N, 0, N]);
  assert(g4.rhrBridges.length === 0, "all-null series: no bridges");
  assert(g4.hrvBridges.length === 1 && g4.hrvBridges[0].fromIndex === 0 && g4.hrvBridges[0].toIndex === 2, "HRV interior gap 0->2 only; trailing null gets none");
  assert(JSON.stringify(g4.bothAbsentIndices) === "[1,3]", "ticks follow the only series with data");

  // Present-point geometry is unchanged by the additions.
  const base = buildRecoveryBalanceGeometry([1, N, 0.5], [0, 1, 0]);
  assert(base.rhrSegments.length === 2 && base.rhrMarkers.length === 2, "segments and markers unchanged by bridges");
}

console.log("recovery-balance fixtures OK");
