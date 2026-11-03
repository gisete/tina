// npx tsx src/lib/charts/gap-trend-model.fixture.ts
import { buildGapModel, bridgeSeriesValues, isolatedPresentIndices } from "./data-gaps";
import { buildTrendRows, fitTrendDomain, tooltipLines } from "./gap-trend-model";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const dates = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
//              present      ABSENT       present      ABSENT       ABSENT       present
const values:   (number | null)[] = [60, null, 62, null, null, 61];
// baseline null on some days, present on absent days (idx 1, 3), null on a present day (idx 2)
const baseline: (number | null)[] = [58, 58.5, null, 59, null, 59.5];

const ctx = { today: "2026-10-26", lastSyncedAtMs: Date.parse("2026-10-26T08:00:00Z"), nowMs: Date.parse("2026-10-26T09:00:00Z") };

// (a) domain includes baseline: baseline 40 and 90 sit outside the values' fit.
const opts = { pad: 2, step: 2, minSpan: 4 };
const [lo, hi] = fitTrendDomain([60, null, 62], [40, 90, null], opts);
assert(lo <= 40 && hi >= 90, `domain [${lo},${hi}] must contain baseline 40..90`);
const [lo2, hi2] = fitTrendDomain([60, null, 62], undefined, opts);
assert(lo2 === 58 && hi2 === 64, `no-baseline domain unchanged, got [${lo2},${hi2}]`);
assert(eq(fitTrendDomain([null, null], [null, 5], opts), fitDomainOfFive()), "baseline-only domain fits the baseline");
function fitDomainOfFive(): [number, number] { return fitTrendDomain([5], undefined, opts); }

// (b1) baseline never affects gap/bridge logic: identical with and without it.
const gaps = buildGapModel(values);
assert(eq(gaps.bridges, [{ fromIndex: 0, toIndex: 2 }, { fromIndex: 2, toIndex: 5 }]), "bridges from actual values only");
assert(eq(gaps.absentIndices, [1, 3, 4]), "absent indices from actual values only");
const iso = new Set(isolatedPresentIndices(values));
const bridgeValues = gaps.bridges.map((b) => bridgeSeriesValues(values, b));
const base = { dates, displayDates: dates, values, pendingIdx: null, isolated: iso, domainMin: 50, bridgeValues };
const withB = buildTrendRows({ ...base, baseline });
const noB = buildTrendRows(base);
const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "baseline"));
assert(eq(withB.map(strip), noB.map(strip)), "rows other than `baseline` identical with/without baseline");

// (b2) connectNulls input: baseline nulls are preserved as null (recharts draws across them).
assert(eq(withB.map((r) => r.baseline), baseline), "baseline passed through with nulls intact");
assert(eq(noB.map((r) => r.baseline), [null, null, null, null, null, null]), "no baseline prop → all null");

// (b3) absent actual day with baseline present: "No reading" for the series, baseline still shown.
const t1 = tooltipLines(withB[1], "Resting HR", "bpm", ctx);
assert(t1.text === "No reading", `absent day text, got "${t1.text}"`);
assert(t1.baseline === "Baseline : 58.5 bpm", `baseline on absent day, got ${t1.baseline}`);
// present actual day, null baseline: no baseline row.
const t2 = tooltipLines(withB[2], "Resting HR", "bpm", ctx);
assert(t2.text === "Resting HR : 62 bpm" && t2.baseline === null, "present/no-baseline day");
// absent and no baseline.
const t4 = tooltipLines(withB[4], "Resting HR", "bpm", ctx);
assert(t4.text === "No reading" && t4.baseline === null, "absent/no-baseline day");
// unitless
assert(tooltipLines(withB[0], "Sleep Score", "", ctx).baseline === "Baseline : 58", "unitless baseline");

console.log("gap-trend-model fixture: all assertions passed");
