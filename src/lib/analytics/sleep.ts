export interface AnalyticStage {
  stageType: "deep" | "light" | "rem" | "awake";
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
  stageType: "deep" | "light" | "rem" | "awake";
  /** ISO 8601 */
  startTime: string;
  /** ISO 8601 */
  endTime: string;
  durationMs: number;
}

/** Output of {@link getLastNightDetail} — all primitives, ready for serialisation. */
export interface LastNightDetail {
  sleepDate: string;
  /** ISO 8601 — session start */
  startTime: string;
  /** ISO 8601 — session end */
  endTime: string;
  totalSleepMs: number;
  efficiencyScore: number;
  /**
   * Aggregated percentage breakdown (0-100) for each stage.
   * Values sum to 100 (within rounding) and are derived from total duration,
   * so they feed directly into a proportional summary bar.
   */
  breakdown: {
    awakePercent: number;
    lightPercent: number;
    remPercent: number;
    deepPercent: number;
  };
  /**
   * Chronologically sorted stage intervals for an hour-by-hour timeline.
   * Sorted ascending by startTime.
   */
  timeline: SleepStageInterval[];
}

/**
 * Calculates the percentage distribution of sleep stages.
 * Ideal targets: Deep (15-25%), REM (20-25%), Light (50-60%)
 */
export function calculateSleepArchitecture(stages: AnalyticStage[]) {
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
    }
  };
}

/**
 * Measures the variability of bedtime onset (Circadian Rhythm consistency).
 * Returns the average bedtime deviation in minutes. High deviation = higher "Social Jetlag".
 */
export function calculateCircadianVariance(sessions: AnalyticSession[]): {
  averageBedtimeMinutesFromMidnight: number;
  standardDeviationMinutes: number;
  status: "stable" | "variable" | "erratic";
} {
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

/**
 * Tracks rolling sleep deprivation compared against an absolute baseline goal.
 * Target is represented in hours (e.g., 8 hours = 8).
 */
export function calculateSleepDebt(sessions: AnalyticSession[], targetHours: number = 8) {
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

// ---------------------------------------------------------------------------
// Last-night detail
// ---------------------------------------------------------------------------

type RawStageInput = {
  stageType: "deep" | "light" | "rem" | "awake";
  startTime: Date | string;
  endTime: Date | string;
  durationMs: number;
};

function toIso(t: Date | string): string {
  return t instanceof Date ? t.toISOString() : t;
}

/**
 * Isolates the most recent sleep session and returns:
 *  - `breakdown`: aggregated percentage per stage (0-100) for a summary bar.
 *  - `timeline`: chronologically sorted {@link SleepStageInterval} array for
 *    an hour-by-hour plot.
 *
 * Accepts sessions whose stages carry full `startTime`/`endTime` data
 * (as returned by the DB query with `with: { stages: true }`).
 *
 * Returns `null` when the sessions array is empty or the latest session has
 * no stage rows.
 *
 * Pure function — no framework imports, no side effects.
 */
export function getLastNightDetail(
  sessions: Array<AnalyticSession & { stages?: RawStageInput[] }>
): LastNightDetail | null {
  if (sessions.length === 0) return null;

  // Pick the session with the latest sleepDate
  const latest = [...sessions].sort((a, b) =>
    b.sleepDate.localeCompare(a.sleepDate)
  )[0];

  const stages = latest.stages ?? [];
  if (stages.length === 0) return null;

  // Aggregate totals for breakdown percentages
  const totals = { deep: 0, light: 0, rem: 0, awake: 0 };
  let grandTotal = 0;
  for (const s of stages) {
    totals[s.stageType] += s.durationMs;
    grandTotal += s.durationMs;
  }

  const breakdown = grandTotal > 0
    ? {
        awakePercent: Math.round((totals.awake / grandTotal) * 100),
        lightPercent: Math.round((totals.light / grandTotal) * 100),
        remPercent: Math.round((totals.rem / grandTotal) * 100),
        deepPercent: Math.round((totals.deep / grandTotal) * 100),
      }
    : { awakePercent: 0, lightPercent: 0, remPercent: 0, deepPercent: 0 };

  // Sort stage intervals ascending by start time
  const timeline: SleepStageInterval[] = [...stages]
    .sort((a, b) => new Date(toIso(a.startTime)).getTime() - new Date(toIso(b.startTime)).getTime())
    .map((s) => ({
      stageType: s.stageType,
      startTime: toIso(s.startTime),
      endTime: toIso(s.endTime),
      durationMs: s.durationMs,
    }));

  return {
    sleepDate: latest.sleepDate,
    startTime: toIso(latest.startTime),
    endTime: toIso(latest.endTime),
    totalSleepMs: latest.totalSleepMs,
    efficiencyScore: latest.efficiencyScore,
    breakdown,
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Fine-grained hypnogram timeline for floating-bar / step charts
// ---------------------------------------------------------------------------

/**
 * Numeric physiological depth tier for the chart Y-axis.
 * Lower values = more restorative sleep (Deep at bottom, Awake at top).
 */
const STAGE_VALUE: Record<string, number> = {
  deep: 0,
  light: 1,
  rem: 2,
  awake: 3,
};

/** One time-marker in the fine-grained hypnogram timeline. */
export interface HypnoDataPoint {
  /** Human-readable clock label for tooltip display — e.g. "11:35 PM", "3:00 AM". */
  timeLabel: string;
  /** Unix milliseconds — canonical value for chronological sorting and X-axis positioning. */
  timestamp: number;
  /**
   * Physiological depth tier:
   *   Deep = 0 · Light = 1 · REM = 2 · Awake = 3
   * Retained for the step-connector Line that stitches stage transitions.
   */
  stageValue: number;
  /**
   * Per-stage range keys. Each key is active ([lower, upper]) only when the
   * current point belongs to that stage; all other keys are null.
   * This lets each stage be bound to its own independent Area series so
   * horizontal blocks render correctly on a continuous time-scale X-axis.
   *
   *   deep  → [-0.2,  0.2]
   *   light → [ 0.8,  1.2]
   *   rem   → [ 1.8,  2.2]
   *   awake → [ 2.8,  3.2]
   */
  deep:  [number, number] | null;
  light: [number, number] | null;
  rem:   [number, number] | null;
  awake: [number, number] | null;
  /** Lowercase stage identifier — drives conditional coloring in chart components. */
  stageName: "deep" | "light" | "rem" | "awake";
}

/**
 * Converts a raw {@link SleepStageInterval} array into a fine-grained,
 * chronologically sorted array of {@link HypnoDataPoint} objects for a
 * per-stage Area hypnogram chart.
 *
 * **Sampling strategy** — one point is emitted per stage *transition boundary*
 * (the exact millisecond the device logged a state change), preserving every
 * micro-interruption without smoothing. A closing sentinel is appended at the
 * last stage's `endTime` with all four range keys set to null so each Area
 * series drops cleanly at the true session boundary.
 *
 * Pure function — no side effects, no framework imports.
 */
export function buildHypnoTimeline(stages: SleepStageInterval[]): HypnoDataPoint[] {
  if (stages.length === 0) return [];

  const sorted = [...stages].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  function makePoint(ts: number, type: "deep" | "light" | "rem" | "awake", closing = false): HypnoDataPoint {
    return {
      timeLabel: new Date(ts).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      timestamp: ts,
      stageValue: STAGE_VALUE[type] ?? 1,
      deep:  !closing && type === "deep"  ? [-0.2, 0.2] : null,
      light: !closing && type === "light" ? [0.8,  1.2] : null,
      rem:   !closing && type === "rem"   ? [1.8,  2.2] : null,
      awake: !closing && type === "awake" ? [2.8,  3.2] : null,
      stageName: type,
    };
  }

  const points = sorted.map((stage) =>
    makePoint(new Date(stage.startTime).getTime(), stage.stageType)
  );

  // Closing sentinel — all range keys null so Area series terminate exactly
  // at the session end rather than extending indefinitely beyond it.
  const last = sorted[sorted.length - 1];
  points.push(makePoint(new Date(last.endTime).getTime(), last.stageType, true));

  return points;
}
