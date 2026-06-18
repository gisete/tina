// npx tsx src/lib/analytics/sleep/score.fixture.ts
import { calculateSleepScoreBreakdown, calculateHolisticSleepScore } from "./score";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

const totalSleepMs      = 7 * 3_600_000;
const timeInBedMs       = 8 * 3_600_000;
const deepContinuity    = 70;
const disruptionIndex   = 80;

// (a) With cardiac — all five present, weights sum to 1, contributions sum to score.
const withCardiac = calculateSleepScoreBreakdown(
  totalSleepMs, timeInBedMs, deepContinuity, disruptionIndex, 60
);
assert(withCardiac.components.length === 5, "five components returned");
assert(withCardiac.components.every((c) => c.present), "all five present");
const sumWeightsA = withCardiac.components.reduce((s, c) => s + c.weight, 0);
assert(Math.abs(sumWeightsA - 1) < 1e-9, `weights sum to 1, got ${sumWeightsA}`);
const sumContribA = withCardiac.components.reduce((s, c) => s + c.contribution, 0);
assert(Math.abs(sumContribA - withCardiac.score) <= 0.5, `contributions sum to score: ${sumContribA} vs ${withCardiac.score}`);

// (b) Without cardiac — cardiac.present === false, other four weights sum to 1, contributions sum to score.
const noCardiac = calculateSleepScoreBreakdown(
  totalSleepMs, timeInBedMs, deepContinuity, disruptionIndex, null
);
assert(noCardiac.components.length === 5, "five components returned even without cardiac");
const cardiac = noCardiac.components.find((c) => c.key === "cardiac")!;
assert(!cardiac.present, "cardiac.present === false");
assert(cardiac.subScore === null, "cardiac.subScore === null");
assert(cardiac.weight === 0, "cardiac.weight === 0");
assert(cardiac.contribution === 0, "cardiac.contribution === 0");
const presentComps = noCardiac.components.filter((c) => c.present);
const sumWeightsB = presentComps.reduce((s, c) => s + c.weight, 0);
assert(Math.abs(sumWeightsB - 1) < 1e-9, `four weights sum to 1, got ${sumWeightsB}`);
const sumContribB = presentComps.reduce((s, c) => s + c.contribution, 0);
assert(Math.abs(sumContribB - noCardiac.score) <= 0.5, `contributions sum to score: ${sumContribB} vs ${noCardiac.score}`);

// (c) calculateHolisticSleepScore === breakdown.score for both cases.
const holisticWith = calculateHolisticSleepScore(totalSleepMs, timeInBedMs, deepContinuity, disruptionIndex, 60);
assert(holisticWith === withCardiac.score, `holistic with cardiac: ${holisticWith} === ${withCardiac.score}`);
const holisticNo = calculateHolisticSleepScore(totalSleepMs, timeInBedMs, deepContinuity, disruptionIndex, null);
assert(holisticNo === noCardiac.score, `holistic without cardiac: ${holisticNo} === ${noCardiac.score}`);

console.log(`All assertions passed.`);
console.log(`  with cardiac: score=${withCardiac.score}, components=${withCardiac.components.map((c) => `${c.key}:${c.contribution.toFixed(1)}`).join(", ")}`);
console.log(`  without cardiac: score=${noCardiac.score}, components=${noCardiac.components.filter((c) => c.present).map((c) => `${c.key}:${c.contribution.toFixed(1)}`).join(", ")}`);
