import type { AnalyticSession } from "./types";
import { parseLocalDate } from "@/lib/dates";

/** Number of most-recent sessions considered for the decayed debt sum. */
const DEBT_WINDOW_DAYS = 14;

/**
 * Half-life for the exponential decay (days). A deficit night 4 days ago
 * contributes half as much pressure as an equally-sized deficit last night.
 * Grounded in sleep-homeostasis literature: ~96–120h for Process S dissipation.
 */
const HALF_LIFE_DAYS = 4;

/**
 * Fraction of a surplus night that repays existing debt. Sleep debt does not
 * recover as efficiently as it accumulates — physiologically, you cannot fully
 * "bank" extra sleep.
 */
const SURPLUS_EFFICIENCY = 0.5;

export interface SleepDebtEntry {
  date: string;
  netDifferenceHours: number;
  runningDebtHours: number;
}

export interface DebtHistoryEntry {
  date: string;
  netDifferenceHours: number;
  runningDebtHours: number;
}

export interface SleepDebt {
  cumulativeDebtHours: number;
  /** Effective look-back window used for the decay calculation. */
  weightedWindowDays: number;
  timeline: SleepDebtEntry[];
  severity: "high" | "moderate" | "optimal";
}

/**
 * Full historical debt timeline for the debt detail page. Each entry uses a
 * DEBT_WINDOW_DAYS rolling window anchored to that session's date, so the
 * running debt can rise and fall across the full history (not just 14 nights).
 * Sessions must already be filtered to main sessions (no naps).
 */
export function buildDebtHistory(
  sessions: Array<{ sleepDate: string; totalSleepMs: number }>,
  targetHours: number = 8
): DebtHistoryEntry[] {
  const targetMs = targetHours * 3_600_000;
  const sorted = [...sessions].sort((a, b) => a.sleepDate.localeCompare(b.sleepDate));

  return sorted.map((s, i) => {
    const windowStart = Math.max(0, i - DEBT_WINDOW_DAYS + 1);
    const refDate = s.sleepDate;
    let sum = 0;
    for (let j = windowStart; j <= i; j++) {
      const ageDays = daysBetween(sorted[j].sleepDate, refDate);
      const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      const net = targetMs - sorted[j].totalSleepMs;
      sum += net >= 0 ? net * weight : net * weight * SURPLUS_EFFICIENCY;
    }
    return {
      date: s.sleepDate,
      netDifferenceHours: msToHours(targetMs - s.totalSleepMs),
      runningDebtHours: msToHours(Math.max(0, sum)),
    };
  });
}

function msToHours(ms: number): number {
  return Number((ms / 3_600_000).toFixed(2));
}

function daysBetween(olderDate: string, newerDate: string): number {
  return (parseLocalDate(newerDate).getTime() - parseLocalDate(olderDate).getTime()) / 86_400_000;
}

/**
 * Decayed sleep-debt model.
 *
 * Each night's deficit/surplus is weighted by 0.5^(ageDays / HALF_LIFE_DAYS),
 * where age is measured from the most-recent session. Surplus nights recover
 * debt at SURPLUS_EFFICIENCY to reflect the physiological asymmetry of
 * sleep homeostasis. Only the most recent DEBT_WINDOW_DAYS sessions
 * contribute; older nights have decayed to < 9% weight and are negligible.
 *
 * Severity thresholds: < 5h "optimal", 5–10h "moderate", > 10h "high".
 */
export function calculateSleepDebt(
  sessions: AnalyticSession[],
  targetHours: number = 8
): SleepDebt {
  const targetMs = targetHours * 3_600_000;

  const sorted = [...sessions]
    .sort((a, b) => a.sleepDate.localeCompare(b.sleepDate))
    .slice(-DEBT_WINDOW_DAYS);

  if (sorted.length === 0) {
    return { cumulativeDebtHours: 0, weightedWindowDays: 0, timeline: [], severity: "optimal" };
  }

  // Decayed sum from sessions[0..upTo] with sessions[upTo] as age-0 reference.
  function partialDebtMs(upTo: number): number {
    const refDate = sorted[upTo].sleepDate;
    let sum = 0;
    for (let j = 0; j <= upTo; j++) {
      const ageDays = daysBetween(sorted[j].sleepDate, refDate);
      const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      const net = targetMs - sorted[j].totalSleepMs;
      sum += net >= 0 ? net * weight : net * weight * SURPLUS_EFFICIENCY;
    }
    return Math.max(0, sum);
  }

  const timeline: SleepDebtEntry[] = sorted.map((s, i) => ({
    date: s.sleepDate,
    netDifferenceHours: msToHours(targetMs - s.totalSleepMs),
    runningDebtHours: msToHours(partialDebtMs(i)),
  }));

  const cumulativeDebtHours = timeline[timeline.length - 1].runningDebtHours;

  const severity: SleepDebt["severity"] =
    cumulativeDebtHours > 10 ? "high"
    : cumulativeDebtHours >= 5 ? "moderate"
    : "optimal";

  return { cumulativeDebtHours, weightedWindowDays: DEBT_WINDOW_DAYS, timeline, severity };
}
