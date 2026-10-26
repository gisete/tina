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
  /** UTC offset (seconds) at session start/end; null/absent = unknown (server-local zone). */
  startUtcOffsetSeconds?: number | null;
  endUtcOffsetSeconds?: number | null;
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
