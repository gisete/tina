// Fixtures for the honest state cards (circadian nights, debt window span).
// Run: npx tsx scripts/state-card-check.ts
import assert from "node:assert/strict";
import { MIN_CIRCADIAN_NIGHTS, calculateCircadianVariance, calculateSleepDebt } from "@/lib/analytics/sleep";
import { formatDebtBasis } from "@/lib/format";
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

// Debt window: counts and span, debt math untouched
{
  const nights = (dates: string[]) => dates.map((d) => ({ ...session(d), totalSleepMs: 6 * H }));
  const consecutive = calculateSleepDebt(nights(Array.from({ length: 14 }, (_, i) => day(i))));
  assert.equal(consecutive.nightsUsed, 14);
  assert.equal(consecutive.windowSpanDays, 14);
  assert.equal(formatDebtBasis(consecutive.nightsUsed, consecutive.windowSpanDays), null);

  const gappy = calculateSleepDebt(nights([0, 1, 2, 5, 6, 8, 9, 10, 13, 14, 15, 17, 19, 20, 21, 22].map(day)));
  assert.equal(gappy.nightsUsed, 14);
  assert.equal(gappy.windowSpanDays, 21); // oldest kept night is day index 2, newest 22, inclusive
  assert.equal(formatDebtBasis(gappy.nightsUsed, gappy.windowSpanDays), "based on 14 nights over 21 days");

  const one = calculateSleepDebt(nights([day(0)]));
  assert.equal(one.nightsUsed, 1);
  assert.equal(one.windowSpanDays, 1);
  const empty = calculateSleepDebt([]);
  assert.deepEqual([empty.nightsUsed, empty.windowSpanDays, empty.cumulativeDebtHours], [0, 0, 0]);

  // Debt math unchanged: 14 x 6h at an 8h target (reference values recorded from the pre-change engine)
  assert.equal(consecutive.cumulativeDebtHours, 11.46);
  assert.equal(gappy.cumulativeDebtHours, 9.57);
}

console.log("ALL CHECKS PASSED");
