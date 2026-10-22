// Fixtures for night-totals, target-bar and splitDurationMins. Run: npx tsx scripts/sleep-page-check.ts
import assert from "node:assert/strict";
import { summarizeNightTotals } from "@/lib/analytics/sleep";
import { buildTargetBar } from "@/lib/charts/target-bar";
import { splitDurationMins } from "@/lib/format";

const MIN = 60000;
const start = new Date(2026, 9, 21, 22, 55).toISOString();
const end = new Date(2026, 9, 22, 6, 34).toISOString();
const t = summarizeNightTotals(431 * MIN, start, end);
assert.deepEqual([t.asleepMins, t.inBedMins, t.awakeInBedMins], [431, 459, 28]);
assert.equal(Math.round((t.efficiency as number) * 100), 94);
assert.equal(summarizeNightTotals(431 * MIN, start, start).efficiency, null);
assert.deepEqual(splitDurationMins(431), { hours: 7, minutes: 11 });

const deep = buildTargetBar(14, 15, 20);
assert.equal(deep.axisMax, 30);
assert.equal(deep.fillPct.toFixed(1), "46.7");
assert.equal(deep.bandLeftPct, 50);
assert.equal(deep.bandWidthPct.toFixed(1), "16.7");
assert.equal(buildTargetBar(120, 50, 60).fillPct, 100, "clamped");
console.log("sleep-page fixtures OK");
