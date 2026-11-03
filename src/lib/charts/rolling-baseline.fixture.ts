// npx tsx src/lib/charts/rolling-baseline.fixture.ts
import { addDays } from "@/lib/dates";
import { rollingBaselineForWindow, rollingReadingBaseline, type DatedValue } from "./rolling-baseline";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const mk = (start: string, vals: (number | null)[]): DatedValue[] =>
  vals.map((value, i) => ({ date: addDays(start, i), value }));
const S = "2026-09-01";

// Fewer than 3 prior readings → null; third prior reading → mean.
const a = rollingReadingBaseline(mk(S, [60, 62, 64, 70]));
assert(eq(a, [null, null, null, 62]), `min readings: ${JSON.stringify(a)}`);

// Own value excluded: the spike at idx 7 is not in its own baseline.
const spike = rollingReadingBaseline(mk(S, [60, 60, 60, 60, 60, 60, 60, 100]));
assert(spike[7] === 60, `spike excluded, got ${spike[7]}`);
// ...but it does enter the next day's baseline: (100 + 6*60)/7 = 65.714 → 65.7
const after = rollingReadingBaseline(mk(S, [60, 60, 60, 60, 60, 60, 60, 100, 60]));
assert(after[8] === 65.7, `next day includes spike, got ${after[8]}`);

// Only the 7 most recent readings: 10 readings of 1..10, day 11 → mean(4..10)=7.
const seven = rollingReadingBaseline(mk(S, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0]));
assert(seven[10] === 7, `7 most recent, got ${seven[10]}`);

// Gap in the middle: absent days are skipped, not counted, and the baseline keeps averaging real readings.
const gap = rollingReadingBaseline(mk(S, [50, 52, null, null, null, 54, 56, 58]));
// idx5: prior readings 50,52 → only 2 → null. idx6: 50,52,54 → 52. idx7: 50,52,54,56 → 53.
assert(eq(gap.slice(5), [null, 52, 53]), `gap skipping: ${JSON.stringify(gap)}`);
// Absent day itself still gets a baseline (so the dashed line can show on it).
assert(gap[3] === null, "absent day with only 2 prior readings → null");
const gap2 = rollingReadingBaseline(mk(S, [50, 52, 54, null, null, 60]));
assert(gap2[4] === 52 && gap2[5] === 52, `absent days carry baseline, got ${JSON.stringify(gap2)}`);

// A reading older than 28 calendar days is ignored.
const old: DatedValue[] = [
  { date: addDays("2026-10-30", -29), value: 999 }, // 29 days before → ignored
  { date: addDays("2026-10-30", -28), value: 10 },  // exactly 28 → counts
  { date: addDays("2026-10-30", -2), value: 20 },
  { date: addDays("2026-10-30", -1), value: 30 },
  { date: "2026-10-30", value: 0 },
];
const o = rollingReadingBaseline(old);
assert(o[4] === 20, `29-day-old reading ignored, 28-day counted: got ${o[4]}`);
const tooOld = rollingReadingBaseline([...old.slice(0, 1), ...old.slice(2)]);
assert(tooOld[3] === null, `only 2 in-range readings → null, got ${tooOld[3]}`);

// Lookback: day 1 of the window already has a baseline from pre-window history.
const history = mk("2026-08-01", Array.from({ length: 100 }, (_, i) => 60 + (i % 5))); // through 2026-11-08
const win = Array.from({ length: 7 }, (_, i) => addDays("2026-11-02", i));
const wb = rollingBaselineForWindow(history, win);
assert(wb.length === 7 && wb[0] !== null, `window day 1 has a baseline, got ${wb[0]}`);
// Day 1 baseline equals the function over the full series at that date.
const full = rollingReadingBaseline(history);
const idx = history.findIndex((p) => p.date === win[0]);
assert(wb[0] === full[idx], "window slice equals full-series baseline");
// With no history before the window and unsorted/gappy series input, still safe.
const none = rollingBaselineForWindow([], win);
assert(none.every((v) => v === null), "no data → all null");

console.log("rolling-baseline fixture: all assertions passed");
