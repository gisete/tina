// Fixtures for the honest state cards (circadian nights, debt window span).
// Run: npx tsx scripts/state-card-check.ts
import assert from "node:assert/strict";
import { MIN_CIRCADIAN_NIGHTS, calculateCircadianVariance } from "@/lib/analytics/sleep";
import type { AnalyticSession } from "@/lib/analytics/sleep";

const H = 3_600_000;
const session = (sleepDate: string, bedHour = 23): AnalyticSession => ({
  sleepDate,
  startTime: new Date(`${sleepDate}T${String(bedHour).padStart(2, "0")}:00:00`),
  endTime: new Date(`${sleepDate}T23:59:00`),
  totalSleepMs: 8 * H,
  efficiencyScore: 1,
});
const day = (i: number): string => `2026-10-${String(i + 1).padStart(2, "0")}`;

// Circadian: below the minimum the card shows "—" (page rule: nights < MIN)
{
  const one = calculateCircadianVariance([session(day(0))]);
  assert.equal(one.nights, 1);
  assert.ok(one.nights < MIN_CIRCADIAN_NIGHTS);
  assert.equal(calculateCircadianVariance([]).nights, 0);
  const four = calculateCircadianVariance([0, 1, 2, 3].map((i) => session(day(i))));
  assert.ok(four.nights < MIN_CIRCADIAN_NIGHTS);
  const five = calculateCircadianVariance([0, 1, 2, 3, 4].map((i) => session(day(i))));
  assert.ok(five.nights >= MIN_CIRCADIAN_NIGHTS);
  // stdev math unchanged: identical bedtimes -> 0; 22:00 vs 00:00 -> 60
  assert.equal(five.standardDeviationMinutes, 0);
  const spread = calculateCircadianVariance([session(day(0), 22), session(day(1), 0)]);
  assert.equal(spread.standardDeviationMinutes, 60);
}

console.log("ALL CHECKS PASSED");
