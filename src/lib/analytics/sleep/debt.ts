import type { AnalyticSession } from "./types";

export interface SleepDebtEntry {
  date: string;
  netDifferenceHours: number;
  runningDebtHours: number;
}

export interface SleepDebt {
  cumulativeDebtHours: number;
  timeline: SleepDebtEntry[];
  severity: "high" | "moderate" | "optimal";
}

/**
 * Tracks rolling sleep deprivation compared against an absolute baseline goal.
 * Target is represented in hours (e.g., 8 hours = 8).
 */
export function calculateSleepDebt(sessions: AnalyticSession[], targetHours: number = 8): SleepDebt {
  const targetMs = targetHours * 60 * 60 * 1000;
  let totalDebtMs = 0;

  // We sort old to new to observe debt progression chronologically
  const sortedSessions = [...sessions].sort((a, b) =>
    new Date(a.sleepDate).getTime() - new Date(b.sleepDate).getTime()
  );

  const trackingTimeline = sortedSessions.map(session => {
    const difference = targetMs - session.totalSleepMs;
    totalDebtMs += difference;

    return {
      date: session.sleepDate,
      netDifferenceHours: Number((difference / (1000 * 60 * 60)).toFixed(2)),
      runningDebtHours: Number((totalDebtMs / (1000 * 60 * 60)).toFixed(2))
    };
  });

  return {
    cumulativeDebtHours: Number((totalDebtMs / (1000 * 60 * 60)).toFixed(2)),
    timeline: trackingTimeline,
    severity: totalDebtMs > (targetMs * 2) ? "high" : totalDebtMs > 0 ? "moderate" : "optimal"
  };
}
