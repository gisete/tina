// Pure TypeScript cardiovascular analytics engine.
// Zero framework imports — outputs plain JS primitives that serialize cleanly
// to JSON for server actions, REST responses, and React Native consumers.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type StressStatus = "Elevated Stress" | "Stable Baseline" | "Insufficient Data";

/**
 * Minimal row shape accepted from the heart_rate_summaries table.
 * Only the three fields this engine actually reads are required — the
 * remaining auto-generated columns (id, userId, createdAt, updatedAt)
 * are intentionally omitted to keep callers loosely coupled.
 */
export interface HeartRateSummaryRow {
  date: string;                   // YYYY-MM-DD
  restingHeartRate: number | null;
  hrvRmssd: number | null;
}

/** Per-day analysis record. Every field is a plain primitive — JSON-safe. */
export interface DailyHeartAnalysis {
  date: string;
  rhr: number | null;
  hrv: number | null;
  /** 7-day look-back rolling average for RHR. Null when history is insufficient. */
  baselineRhr: number | null;
  /** 7-day look-back rolling average for HRV. Null when history is insufficient. */
  baselineHrv: number | null;
  status: StressStatus;
}

export interface HeartAnalyticsResult {
  /**
   * Macro averages across the entire input window.
   * Intended for summary cards — not the same as the per-day rolling baseline.
   */
  overallBaseline: {
    avgRhr: number | null;
    avgHrv: number | null;
  };
  daily: DailyHeartAnalysis[];
  latestStatus: StressStatus;
  latestDate: string | null;
}

// ---------------------------------------------------------------------------
// Thresholds & constants
// ---------------------------------------------------------------------------

/** Rolling look-back window size (days prior to the current day). */
const WINDOW_DAYS = 7;

/**
 * Minimum number of non-null readings inside the look-back window needed to
 * consider the baseline reliable. Days with fewer data points yield
 * "Insufficient Data" rather than a potentially misleading status.
 */
const MIN_WINDOW_POINTS = 3;

/**
 * RHR stress threshold: flag "Elevated Stress" when today's resting heart rate
 * exceeds the rolling baseline by more than this fraction (0.10 = 10%).
 */
const RHR_RISE_THRESHOLD = 0.10;

/**
 * HRV stress threshold: flag "Elevated Stress" when today's HRV RMSSD falls
 * more than this fraction below the rolling baseline (0.10 = 10%).
 * Lower HRV indicates higher autonomic strain.
 */
const HRV_DROP_THRESHOLD = 0.10;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Removes null/undefined entries while narrowing the type to number[]. */
function compact(arr: (number | null | undefined)[]): number[] {
  return arr.filter((v): v is number => v !== null && v !== undefined);
}

/**
 * Derives the stress status for a single day given its actual readings and the
 * pre-computed rolling baseline averages for that day.
 *
 * Rules (applied in order):
 *  1. If no baseline can be computed for either available metric → "Insufficient Data"
 *  2. RHR > baseline * 1.10  OR  HRV < baseline * 0.90 → "Elevated Stress"
 *  3. Otherwise → "Stable Baseline"
 *
 * A single elevated indicator is sufficient to flag stress.
 * When a metric has no reading today its check is skipped; the remaining
 * metric alone determines the status.
 */
function deriveStatus(
  rhr: number | null,
  hrv: number | null,
  baselineRhr: number | null,
  baselineHrv: number | null,
): StressStatus {
  const canEvalRhr = rhr !== null && baselineRhr !== null;
  const canEvalHrv = hrv !== null && baselineHrv !== null;

  if (!canEvalRhr && !canEvalHrv) return "Insufficient Data";

  if (canEvalRhr && rhr! > baselineRhr! * (1 + RHR_RISE_THRESHOLD)) {
    return "Elevated Stress";
  }

  if (canEvalHrv && hrv! < baselineHrv! * (1 - HRV_DROP_THRESHOLD)) {
    return "Elevated Stress";
  }

  return "Stable Baseline";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute rolling 7-day cardiovascular baselines and daily stress/recovery
 * status for an array of heart_rate_summaries rows.
 *
 * Input rows do not need to be pre-sorted — the function sorts by date
 * internally. Gaps in the date sequence (missed days) are handled gracefully:
 * the look-back window uses up to 7 actual rows of history regardless of
 * whether calendar days in between are missing.
 */
export function calculateHeartAnalytics(rows: HeartRateSummaryRow[]): HeartAnalyticsResult {
  if (rows.length === 0) {
    return {
      overallBaseline: { avgRhr: null, avgHrv: null },
      daily: [],
      latestStatus: "Insufficient Data",
      latestDate: null,
    };
  }

  // Sort ascending so index 0 is the oldest recorded day
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  const daily: DailyHeartAnalysis[] = sorted.map((row, i) => {
    // Window = up to WINDOW_DAYS rows strictly before the current index
    const windowRows = sorted.slice(Math.max(0, i - WINDOW_DAYS), i);

    const windowRhr = compact(windowRows.map((r) => r.restingHeartRate));
    const windowHrv = compact(windowRows.map((r) => r.hrvRmssd));

    const rawBaselineRhr = windowRhr.length >= MIN_WINDOW_POINTS ? average(windowRhr) : null;
    const rawBaselineHrv = windowHrv.length >= MIN_WINDOW_POINTS ? average(windowHrv) : null;

    const rhr = row.restingHeartRate ?? null;
    const hrv = row.hrvRmssd ?? null;

    // Comparison uses the raw float baselines for precision; rounded values
    // are stored in the output object for display and serialization.
    const status = deriveStatus(rhr, hrv, rawBaselineRhr, rawBaselineHrv);

    return {
      date: row.date,
      rhr,
      hrv,
      baselineRhr: rawBaselineRhr !== null ? Math.round(rawBaselineRhr) : null,
      baselineHrv: rawBaselineHrv !== null ? parseFloat(rawBaselineHrv.toFixed(1)) : null,
      status,
    };
  });

  // Overall macro averages across the full input window (for summary cards)
  const allRhr = compact(sorted.map((r) => r.restingHeartRate));
  const allHrv = compact(sorted.map((r) => r.hrvRmssd));

  const avgRhr = average(allRhr);
  const avgHrv = average(allHrv);

  const latest = daily[daily.length - 1];

  return {
    overallBaseline: {
      avgRhr: avgRhr !== null ? Math.round(avgRhr) : null,
      avgHrv: avgHrv !== null ? parseFloat(avgHrv.toFixed(1)) : null,
    },
    daily,
    latestStatus: latest.status,
    latestDate: latest.date,
  };
}
