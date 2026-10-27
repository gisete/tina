// Spot-check: run with `npx tsx scripts/data-gaps-check.ts`
// (also under TZ=America/Los_Angeles / Pacific/Auckland).
import assert from "node:assert/strict";
import { buildGapModel, bridgeSeriesValues, isolatedPresentIndices, pendingTodayIndex, absenceLabel, absenceText } from "@/lib/charts/data-gaps";
import { addDays } from "@/lib/dates";

console.log("TZ:", Intl.DateTimeFormat().resolvedOptions().timeZone);
const N = null;

/** Every bridge must span only nulls, and bridge ends must be present. */
function assertBridgesOnlyCrossNulls(points: (number | null)[]): void {
  const m = buildGapModel(points);
  for (const b of m.bridges) {
    assert.notEqual(points[b.fromIndex], null);
    assert.notEqual(points[b.toIndex], null);
    for (let i = b.fromIndex + 1; i < b.toIndex; i++) assert.equal(points[i], null, `index ${i} inside bridge ${b.fromIndex}->${b.toIndex}`);
    assert.ok(b.toIndex - b.fromIndex >= 2, "a bridge spans at least one null");
  }
}

// 1. No gaps.
{
  const p = [70, 71, 72];
  const m = buildGapModel(p);
  assert.deepEqual(m, { presentIndices: [0, 1, 2], absentIndices: [], bridges: [], leadingAbsent: [], trailingAbsent: [] });
}
// 2. One interior gap.
{
  const p = [70, N, N, 72];
  const m = buildGapModel(p);
  assert.deepEqual(m.bridges, [{ fromIndex: 0, toIndex: 3 }]);
  assert.deepEqual(m.absentIndices, [1, 2]);
  assert.deepEqual(m.leadingAbsent, []);
  assert.deepEqual(m.trailingAbsent, []);
  assertBridgesOnlyCrossNulls(p);
}
// 3. A gap B gap C -> (A,B) and (B,C).
{
  const p = [1, N, 2, N, N, 3];
  assert.deepEqual(buildGapModel(p).bridges, [{ fromIndex: 0, toIndex: 2 }, { fromIndex: 2, toIndex: 5 }]);
  assertBridgesOnlyCrossNulls(p);
}
// 4. gap, long present run, gap: two bridges, neither spans the run.
{
  const p = [1, N, 2, 3, 4, 5, 6, 7, N, N, 8];
  const m = buildGapModel(p);
  assert.deepEqual(m.bridges, [{ fromIndex: 0, toIndex: 2 }, { fromIndex: 7, toIndex: 10 }]);
  assertBridgesOnlyCrossNulls(p);
}
// 5. Leading + trailing absences: no bridge, no extrapolation.
{
  const p = [N, N, 5, 6, N];
  const m = buildGapModel(p);
  assert.deepEqual(m.bridges, []);
  assert.deepEqual(m.leadingAbsent, [0, 1]);
  assert.deepEqual(m.trailingAbsent, [4]);
  assert.deepEqual(m.absentIndices, [0, 1, 4]);
}
// 6. All null.
{
  const m = buildGapModel([N, N, N]);
  assert.deepEqual(m.presentIndices, []);
  assert.deepEqual(m.bridges, []);
  assert.deepEqual(m.absentIndices, [0, 1, 2]);
  assert.deepEqual(m.leadingAbsent, [0, 1, 2]);
  assert.deepEqual(m.trailingAbsent, []);
  assert.deepEqual(buildGapModel([]), { presentIndices: [], absentIndices: [], bridges: [], leadingAbsent: [], trailingAbsent: [] });
}
// 7. Single present point.
{
  const m = buildGapModel([N, 9, N]);
  assert.deepEqual(m.bridges, []);
  assert.deepEqual(m.presentIndices, [1]);
  assert.deepEqual(m.leadingAbsent, [0]);
  assert.deepEqual(m.trailingAbsent, [2]);
}
// 8. Zero is a present value, not an absence.
{
  const m = buildGapModel([0, N, 0]);
  assert.deepEqual(m.presentIndices, [0, 2]);
  assert.deepEqual(m.bridges, [{ fromIndex: 0, toIndex: 2 }]);
}
// 9. A window across 2026-10-25 (clock change), built from civil dates.
{
  const start = "2026-10-21";
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i)); // 10-21 .. 10-27
  assert.deepEqual([dates[4], dates[5]], ["2026-10-25", "2026-10-26"]);
  const have = new Set(["2026-10-21", "2026-10-22", "2026-10-24"]);
  const p = dates.map((d, i) => (have.has(d) ? i : N));
  const m = buildGapModel(p);
  assert.deepEqual(m.bridges, [{ fromIndex: 1, toIndex: 3 }]); // 10-22 -> 10-24 over 10-23
  assert.deepEqual(m.trailingAbsent.map((i) => dates[i]), ["2026-10-25", "2026-10-26", "2026-10-27"]);
  assertBridgesOnlyCrossNulls(p);
}

// 9b. bridgeSeriesValues: exactly two non-null values, at the bridge ends.
{
  const p = [1, N, 2, 3, N, N, 4];
  const [b1, b2] = buildGapModel(p).bridges;
  assert.deepEqual(bridgeSeriesValues(p, b1), [1, N, 2, N, N, N, N]);
  assert.deepEqual(bridgeSeriesValues(p, b2), [N, N, N, 3, N, N, 4]);
}

// 9c. isolatedPresentIndices.
{
  assert.deepEqual(isolatedPresentIndices([5, N, 6, 7]), [0]);          // first
  assert.deepEqual(isolatedPresentIndices([6, 7, N, 5]), [3]);          // last
  assert.deepEqual(isolatedPresentIndices([6, 7, N, 5, N, 8, 9]), [3]); // middle
  assert.deepEqual(isolatedPresentIndices([N, 4, N]), [1]);             // single point
  assert.deepEqual(isolatedPresentIndices([4]), [0]);                   // lone point, both edges
  assert.deepEqual(isolatedPresentIndices([1, N, 2, N, N, 3]), [0, 2, 5]);
  assert.deepEqual(isolatedPresentIndices([1, 2, 3]), []);              // none
  assert.deepEqual(isolatedPresentIndices([N, N]), []);
  assert.deepEqual(isolatedPresentIndices([]), []);
  assert.deepEqual(isolatedPresentIndices([0, N, 0, 0]), [0]);          // zero is present
  // A-gap-B-gap-C: B isolated, and A, C only if they lack a present neighbour.
  assert.deepEqual(isolatedPresentIndices([1, 1, N, 2, N, 3, 3]), [3]);
}

// 9d. todayIsPending exclusion.
{
  const dates = ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
  const today = "2026-10-27";
  const withToday = [80, N, 85, N];
  assert.equal(pendingTodayIndex(dates, withToday, today, true), 3);
  assert.equal(pendingTodayIndex(dates, withToday, today, false), null);        // chart did not opt in
  assert.equal(pendingTodayIndex(dates, [80, N, 85, 90], today, true), null);   // today has a value: nothing changes
  assert.equal(pendingTodayIndex(dates, withToday, "2026-10-28", true), null);  // last point is not today
  assert.equal(pendingTodayIndex([], [], today, true), null);

  const ignored = buildGapModel(withToday, { ignoreIndex: 3 });
  assert.deepEqual(ignored.absentIndices, [1]);
  assert.deepEqual(ignored.trailingAbsent, []);
  assert.deepEqual(ignored.leadingAbsent, []);
  assert.deepEqual(ignored.bridges, [{ fromIndex: 0, toIndex: 2 }]);
  // Same input without the option still counts it.
  assert.deepEqual(buildGapModel(withToday).trailingAbsent, [3]);
  // Today present: model identical with or without the option.
  const full = [80, N, 85, 90];
  assert.deepEqual(buildGapModel(full, { ignoreIndex: pendingTodayIndex(dates, full, today, true) }), buildGapModel(full));
  // Only absence is pending today: nothing to draw, so no caption.
  const none = buildGapModel([80, 81, 82, N], { ignoreIndex: 3 });
  assert.equal(none.bridges.length + none.absentIndices.length, 0);
}

// 10. absenceLabel. today 2026-10-26; re-fetch window 10-23 .. 10-26; stale after 6h.
{
  const HOUR = 3_600_000;
  const now = Date.UTC(2026, 9, 26, 12, 0, 0);
  const fresh = { today: "2026-10-26", lastSyncedAtMs: now - 1 * HOUR, nowMs: now };
  const stale = { today: "2026-10-26", lastSyncedAtMs: now - 7 * HOUR, nowMs: now };
  const never = { today: "2026-10-26", lastSyncedAtMs: null, nowMs: now };
  assert.equal(absenceLabel("2026-10-26", fresh), "no-reading");
  assert.equal(absenceLabel("2026-10-26", stale), "not-synced-yet");
  assert.equal(absenceLabel("2026-10-23", stale), "not-synced-yet"); // window edge
  assert.equal(absenceLabel("2026-10-22", stale), "no-reading");     // just outside
  assert.equal(absenceLabel("2026-10-25", stale), "not-synced-yet"); // across the clock change
  assert.equal(absenceLabel("2026-10-25", never), "not-synced-yet");
  assert.equal(absenceLabel("2026-10-27", stale), "no-reading");     // future date
  assert.equal(absenceLabel("2026-10-05", never), "no-reading");     // old day is never "not synced yet"
  assert.equal(absenceLabel("2026-10-24", { ...stale, lastSyncedAtMs: now - 6 * HOUR }), "no-reading"); // exactly 6h is not stale
  for (const l of ["no-reading", "not-synced-yet"] as const) assert.ok(!/missing|fail|error/i.test(absenceText(l)));
  assert.equal(absenceText("no-reading"), "No reading");
  assert.equal(absenceText("not-synced-yet"), "Not synced yet");
}

console.log("ALL CHECKS PASSED");
