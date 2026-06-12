import type { AnalyticSession } from "./types";

export interface CircadianVariance {
  averageBedtimeMinutesFromMidnight: number;
  standardDeviationMinutes: number;
  status: "stable" | "variable" | "erratic";
}

/**
 * Measures the variability of bedtime onset (Circadian Rhythm consistency).
 * Returns the average bedtime deviation in minutes. High deviation = higher "Social Jetlag".
 */
export function calculateCircadianVariance(sessions: AnalyticSession[]): CircadianVariance {
  if (sessions.length < 2) {
    return { averageBedtimeMinutesFromMidnight: 0, standardDeviationMinutes: 0, status: "stable" };
  }

  // Convert each bedtime to minutes relative to midnight (-180 to 480 range to catch late nights vs early bedtimes)
  const bedtimeMinutes = sessions.map(session => {
    const date = new Date(session.startTime);
    const hours = date.getHours();
    const minutes = date.getMinutes();

    // If someone goes to bed at 23:30, it's -30 mins from midnight. If at 01:00, it's +60 mins.
    const totalMins = hours * 60 + minutes;
    return totalMins > 12 * 60 ? totalMins - 24 * 60 : totalMins;
  });

  const mean = bedtimeMinutes.reduce((sum, val) => sum + val, 0) / bedtimeMinutes.length;

  const variance = bedtimeMinutes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / bedtimeMinutes.length;
  const stdDev = Math.round(Math.sqrt(variance));

  let status: "stable" | "variable" | "erratic" = "stable";
  if (stdDev > 30 && stdDev <= 75) status = "variable";
  if (stdDev > 75) status = "erratic";

  return {
    averageBedtimeMinutesFromMidnight: Math.round(mean),
    standardDeviationMinutes: stdDev,
    status
  };
}
