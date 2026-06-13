/**
 * Spot-check for the decayed sleep-debt model.
 *
 * All fixtures are synthetic (no DB) — just pure function assertions.
 *
 * Run: npx tsx scripts/debt-spot-check.ts
 */

import { calculateSleepDebt } from "@/lib/analytics/sleep/debt";
import type { AnalyticSession } from "@/lib/analytics/sleep/types";

const TARGET_HOURS = 8;
const MS_PER_HOUR = 3_600_000;

function makeSession(sleepDate: string, hours: number): AnalyticSession {
  return {
    sleepDate,
    startTime: new Date(`${sleepDate}T22:00:00`),
    endTime: new Date(`${sleepDate}T06:00:00`),
    totalSleepMs: Math.round(hours * MS_PER_HOUR),
    efficiencyScore: hours / TARGET_HOURS,
  };
}

/** Returns the YYYY-MM-DD string `n` days before a reference date. */
function daysAgo(n: number, refDate = "2026-06-12"): string {
  const d = new Date(`${refDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

let pass = 0;
let fail = 0;

function assert(label: string, value: number, min: number, max: number) {
  const ok = value >= min && value <= max;
  const icon = ok ? "✓" : "✗";
  const range = `[${min}, ${max}]`;
  console.log(`  ${icon} ${label}: ${value} ${ok ? "in" : "NOT in"} ${range}`);
  if (ok) pass++; else fail++;
}

console.log("\n=== Sleep Debt Spot-Check ===\n");

// ── (a) 14 perfect 8h nights → 0 ──────────────────────────────────────────
{
  const sessions = Array.from({ length: 14 }, (_, i) =>
    makeSession(daysAgo(13 - i), 8)
  );
  const { cumulativeDebtHours } = calculateSleepDebt(sessions, TARGET_HOURS);
  console.log("(a) 14 perfect 8h nights:");
  assert("debt", cumulativeDebtHours, 0, 0);
}

// ── (b) One 4h night last night → ~4h ─────────────────────────────────────
{
  const sessions = [makeSession(daysAgo(0), 4)];
  const { cumulativeDebtHours } = calculateSleepDebt(sessions, TARGET_HOURS);
  console.log("(b) One 4h night last night:");
  assert("debt", cumulativeDebtHours, 3.9, 4.1);
}

// ── (c) 4h night 14 days ago, perfect 8h since → < 0.5h ──────────────────
{
  const sessions = [
    makeSession(daysAgo(14), 4),
    ...Array.from({ length: 13 }, (_, i) => makeSession(daysAgo(13 - i), 8)),
  ];
  const { cumulativeDebtHours } = calculateSleepDebt(sessions, TARGET_HOURS);
  console.log("(c) 4h night 14 days ago, perfect since:");
  assert("debt", cumulativeDebtHours, 0, 0.5);
}

// ── (d) Chronic 6.5h for 14 nights → stabilizes 6–9h ─────────────────────
{
  const sessions = Array.from({ length: 14 }, (_, i) =>
    makeSession(daysAgo(13 - i), 6.5)
  );
  const { cumulativeDebtHours } = calculateSleepDebt(sessions, TARGET_HOURS);
  // Steady-state analytic: 1.5h × Σ(i=0..13) 0.5^(i/4) ≈ 8.6h
  console.log("(d) Chronic 6.5h/night × 14:");
  assert("debt", cumulativeDebtHours, 6, 9);
}

// ── (e) 10h recovery night after debt → drops by half the surplus ──────────
{
  // Compare [6h,6h,6h,10h] vs [6h,6h,6h,8h] — same reference date, so the
  // only difference is the recovery night's contribution. The surplus is 2h,
  // so the drop should be exactly 2h × SURPLUS_EFFICIENCY(0.5) × weight(1) = 1h.
  const base = [
    makeSession(daysAgo(3), 6),
    makeSession(daysAgo(2), 6),
    makeSession(daysAgo(1), 6),
  ];
  const withNeutral  = calculateSleepDebt([...base, makeSession(daysAgo(0), 8)],  TARGET_HOURS);
  const withRecovery = calculateSleepDebt([...base, makeSession(daysAgo(0), 10)], TARGET_HOURS);
  const drop = withNeutral.cumulativeDebtHours - withRecovery.cumulativeDebtHours;
  console.log("(e) Recovery night vs neutral (same reference date):");
  console.log(`    neutral: ${withNeutral.cumulativeDebtHours}h, recovery: ${withRecovery.cumulativeDebtHours}h, drop: ${drop.toFixed(2)}h`);
  // Exact: 2h surplus × 0.5 efficiency × weight 1.0 = 1h.
  assert("drop = 1h (half the 2h surplus)", drop, 0.95, 1.05);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
