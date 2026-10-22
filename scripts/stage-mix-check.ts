// Fixtures for src/lib/charts/stage-mix.ts. Run: npx tsx scripts/stage-mix-check.ts
import assert from "node:assert/strict";
import { buildStageMix } from "@/lib/charts/stage-mix";

const mix = buildStageMix({ deepMins: 62, lightMins: 269, remMins: 100, awakeMins: 28 });
assert.deepEqual(mix.map((m) => [m.stage, m.grow]), [["deep", 62], ["light", 269], ["rem", 100], ["awake", 28]]);
assert.equal(mix.reduce((a, m) => a + m.grow, 0), 459);

const noAwake = buildStageMix({ deepMins: 62, lightMins: 269, remMins: 100, awakeMins: 0 });
assert.deepEqual(noAwake.map((m) => m.stage), ["deep", "light", "rem"]);

assert.deepEqual(buildStageMix({ deepMins: 0, lightMins: 0, remMins: 0, awakeMins: 0 }), []);
console.log("stage-mix OK");

// liveSleepEfficiency (Today's efficiency): asleep / time in bed, null with none.
import { liveSleepEfficiency } from "@/lib/analytics/sleep";
import { formatEfficiencyPct } from "@/lib/format";
const MIN = 60000;
assert.equal(formatEfficiencyPct(liveSleepEfficiency(431 * MIN, 459 * MIN) as number), "94%");
assert.equal(liveSleepEfficiency(431 * MIN, 0), null);
assert.equal(liveSleepEfficiency(500 * MIN, 459 * MIN), 1, "clamped to 1");
console.log("liveSleepEfficiency OK");
