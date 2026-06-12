import type { AnalyticStage } from "./types";

export interface SleepArchitecture {
  deepPercentage: number;
  remPercentage: number;
  lightPercentage: number;
  awakePercentage: number;
  insights: {
    deepDeficit: boolean;
    remDeficit: boolean;
  };
}

/**
 * Calculates the percentage distribution of sleep stages.
 * Ideal targets: Deep (15-25%), REM (20-25%), Light (50-60%)
 */
export function calculateSleepArchitecture(stages: AnalyticStage[]): SleepArchitecture | null {
  const totals = { deep: 0, light: 0, rem: 0, awake: 0 };
  let grandTotalMs = 0;

  for (const stage of stages) {
    totals[stage.stageType] += stage.durationMs;
    grandTotalMs += stage.durationMs;
  }

  if (grandTotalMs === 0) return null;

  return {
    deepPercentage: Math.round((totals.deep / grandTotalMs) * 100),
    remPercentage: Math.round((totals.rem / grandTotalMs) * 100),
    lightPercentage: Math.round((totals.light / grandTotalMs) * 100),
    awakePercentage: Math.round((totals.awake / grandTotalMs) * 100),
    insights: {
      deepDeficit: (totals.deep / grandTotalMs) < 0.15,
      remDeficit: (totals.rem / grandTotalMs) < 0.20,
    },
  };
}
