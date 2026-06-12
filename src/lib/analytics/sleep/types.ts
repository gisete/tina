/** The four physiological stages reported by the device. */
export type SleepStageType = "deep" | "light" | "rem" | "awake";

export interface AnalyticStage {
  stageType: SleepStageType;
  durationMs: number;
}

export interface AnalyticSession {
  sleepDate: string; // YYYY-MM-DD
  startTime: Date;
  endTime: Date;
  totalSleepMs: number;
  efficiencyScore: number;
  stages?: AnalyticStage[];
}

/** A stage block with full timestamp data, suitable for timeline charts. */
export interface SleepStageInterval {
  stageType: SleepStageType;
  /** ISO 8601 */
  startTime: string;
  /** ISO 8601 */
  endTime: string;
  durationMs: number;
}
