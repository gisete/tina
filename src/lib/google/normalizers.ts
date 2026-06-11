// ---------------------------------------------------------------------------
// Heart Rate & HRV — raw API shapes
// ---------------------------------------------------------------------------

/**
 * Nested date object returned by the Health Connect v4 daily telemetry
 * endpoints instead of an ISO timestamp string.
 */
interface GoogleDateObject {
  year: number;
  month: number;
  day: number;
}

/** A single data point from the `daily-resting-heart-rate` `:reconcile` endpoint. */
export interface GoogleHealthHeartRateDataPoint {
  dailyRestingHeartRate?: {
    /** Calendar date for this measurement — nested inside the metric object. */
    date?: GoogleDateObject;
    /** Returned as a string by the API — must be parsed with parseInt. */
    beatsPerMinute?: string | null;
  };
}

/** A single data point from the `daily-heart-rate-variability` `:reconcile` endpoint. */
export interface GoogleHealthHrvDataPoint {
  dailyHeartRateVariability?: {
    /** Calendar date for this measurement — nested inside the metric object. */
    date?: GoogleDateObject;
    averageHeartRateVariabilityMilliseconds?: number | null;
  };
}

/**
 * The merged, normalised shape for one row in `heart_rate_summaries`.
 * Auto-generated fields (id, createdAt, updatedAt) are excluded.
 */
export interface NormalizedHeartRecord {
  userId: string;
  /** Calendar date the measurements belong to — YYYY-MM-DD */
  date: string;
  restingHeartRate: number | null;
  hrvRmssd: number | null;
}

// ---------------------------------------------------------------------------
// Sleep — raw API shapes
// ---------------------------------------------------------------------------

export interface GoogleHealthStageBlock {
  startTime: string;
  endTime: string;
  type: "LIGHT" | "DEEP" | "REM" | "AWAKE";
}

export interface GoogleHealthSessionBlock {
  name: string;
  sleep?: {
    interval: {
      startTime: string;
      endTime: string;
    };
    stages?: GoogleHealthStageBlock[];
    summary?: {
      minutesInSleepPeriod: string;
      minutesAsleep: string;
      minutesAwake: string;
    };
  };
}

export function normalizeGoogleSleepSession(userId: string, sessionBlock: GoogleHealthSessionBlock) {
  const sleepData = sessionBlock.sleep;
  if (!sleepData || !sleepData.interval) return null;

  const startTime = new Date(sleepData.interval.startTime);
  const endTime = new Date(sleepData.interval.endTime);

  const minutesAsleep = parseInt(sleepData.summary?.minutesAsleep || "0", 10);
  const minutesInPeriod = parseInt(sleepData.summary?.minutesInSleepPeriod || "1", 10);

  const totalSleepMs = minutesAsleep * 60 * 1000;
  const efficiencyScore = minutesInPeriod > 0 ? minutesAsleep / minutesInPeriod : 0;

  // Use the start date string as our calendar tracking key (YYYY-MM-DD)
  const sleepDate = sleepData.interval.startTime.split("T")[0];
  const sessionId = crypto.randomUUID();

  const session = {
    id: sessionId,
    userId,
    sleepDate,
    startTime,
    endTime,
    totalSleepMs,
    efficiencyScore: Math.min(1, Math.max(0, efficiencyScore)),
    source: "google_health",
  };

  const stages = (sleepData.stages || []).map((stage) => {
    const sTime = new Date(stage.startTime);
    const eTime = new Date(stage.endTime);
    const durationMs = eTime.getTime() - sTime.getTime();

    const rawType = stage.type?.toLowerCase() || "light";
    let stageType: "deep" | "light" | "rem" | "awake" = "light";
    if (rawType === "deep") stageType = "deep";
    if (rawType === "rem") stageType = "rem";
    if (rawType === "awake") stageType = "awake";

    return {
      id: crypto.randomUUID(),
      sessionId,
      stageType,
      startTime: sTime,
      endTime: eTime,
      durationMs,
    };
  });

  return { session, stages };
}

// ---------------------------------------------------------------------------
// Heart data normalizer
// ---------------------------------------------------------------------------

/**
 * Builds a YYYY-MM-DD string from a nested GoogleDateObject, using padStart
 * to guarantee two-digit months and days regardless of what the API returns.
 */
function formatDate(d: GoogleDateObject): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/**
 * Resolves a date key from a GoogleDateObject, returning a YYYY-MM-DD string
 * or null if the object is absent.
 */
function extractDateKey(date: GoogleDateObject | undefined): string | null {
  if (!date) return null;
  return formatDate(date);
}

/**
 * Merges `daily-resting-heart-rate` and `daily-heart-rate-variability`
 * data point arrays into one `NormalizedHeartRecord` per calendar date,
 * ready for upsert into the `heart_rate_summaries` table.
 *
 * Key parsing decisions based on confirmed API response shapes:
 *  - date is nested inside dailyRestingHeartRate / dailyHeartRateVariability, not at the top level.
 *  - beatsPerMinute is returned as a string — converted via parseInt.
 *  - HRV metric is averageHeartRateVariabilityMilliseconds — rounded to integer ms.
 *
 * Entries where both metrics are null after parsing are filtered out before
 * returning, so no empty rows reach the database upsert.
 */
export function normalizeHeartData(
  userId: string,
  heartRatePoints: GoogleHealthHeartRateDataPoint[],
  hrvPoints: GoogleHealthHrvDataPoint[]
): NormalizedHeartRecord[] {
  if (heartRatePoints.length > 0) {
    console.log("[normalizer] daily-resting-heart-rate sample point:");
    console.log(JSON.stringify(heartRatePoints[0], null, 2));
  }
  if (hrvPoints.length > 0) {
    console.log("[normalizer] daily-heart-rate-variability sample point:");
    console.log(JSON.stringify(hrvPoints[0], null, 2));
  }

  const byDate: Record<string, { restingHeartRate: number | null; hrvRmssd: number | null }> = {};

  for (const item of heartRatePoints) {
    const date = extractDateKey(item.dailyRestingHeartRate?.date);
    if (!date) continue;

    const raw = item.dailyRestingHeartRate?.beatsPerMinute;
    const parsed = raw != null ? parseInt(String(raw), 10) : NaN;
    const restingHeartRate = !isNaN(parsed) && parsed >= 20 && parsed <= 300 ? parsed : null;

    if (!byDate[date]) {
      byDate[date] = { restingHeartRate, hrvRmssd: null };
    } else if (byDate[date].restingHeartRate === null) {
      byDate[date].restingHeartRate = restingHeartRate;
    }
  }

  for (const item of hrvPoints) {
    const date = extractDateKey(item.dailyHeartRateVariability?.date);
    if (!date) continue;

    const raw = item.dailyHeartRateVariability?.averageHeartRateVariabilityMilliseconds;
    const rounded = raw != null ? Math.round(raw) : null;
    const hrvRmssd = rounded !== null && rounded >= 1 && rounded <= 300 ? rounded : null;

    if (!byDate[date]) {
      byDate[date] = { restingHeartRate: null, hrvRmssd };
    } else if (byDate[date].hrvRmssd === null) {
      byDate[date].hrvRmssd = hrvRmssd;
    }
  }

  return Object.entries(byDate)
    .filter(([, v]) => v.restingHeartRate !== null || v.hrvRmssd !== null)
    .map(([date, v]) => ({
      userId,
      date,
      restingHeartRate: v.restingHeartRate,
      hrvRmssd: v.hrvRmssd,
    }));
}
