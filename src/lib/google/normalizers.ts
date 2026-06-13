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
  /**
   * Known values: LIGHT | DEEP | REM | AWAKE — but the REST docs hedge with
   * "etc." and classic (non-stages) logs may use other levels, so this is
   * typed open and unmapped values are surfaced via warnings.
   */
  type: string;
}

export interface GoogleHealthSessionBlock {
  name: string;
  sleep?: {
    /** SleepType — expected "STAGES" or "CLASSIC". */
    type?: string;
    interval: {
      startTime: string;
      endTime: string;
      /** UTC offset of the user's local timezone at session start, e.g. "3600s" or "-18000s". */
      startUtcOffset?: string;
    };
    stages?: GoogleHealthStageBlock[];
    summary?: {
      minutesInSleepPeriod: string;
      minutesAsleep: string;
      minutesAwake: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Sleep date helpers
// ---------------------------------------------------------------------------

/**
 * Sessions starting before this local hour (6 pm) are early-morning arrivals
 * — the user stayed up past midnight from the previous evening. The calendar
 * date of the night is therefore the day before the UTC start date.
 */
const NIGHT_BOUNDARY_HOUR = 18;

/**
 * Returns the "night-of" local calendar date for a sleep session.
 *
 * A session that begins at 01:06 local time belongs to the night that started
 * the previous evening, not to the early-morning calendar day. We apply the
 * UTC offset to convert the UTC start time to local wall-clock time, then
 * subtract one day when the local hour is before NIGHT_BOUNDARY_HOUR.
 *
 * All arithmetic uses UTC methods on offset-shifted Dates — never toISOString
 * or the Date("YYYY-MM-DD") constructor — to avoid timezone-dependent slippage.
 */
export function nightOf(utcMs: number, offsetSeconds: number): string {
  // Shift the timestamp so that UTC methods read local wall-clock values.
  const d = new Date(utcMs + offsetSeconds * 1000);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() + 1;
  let day = d.getUTCDate();

  if (d.getUTCHours() < NIGHT_BOUNDARY_HOUR) {
    // Step back one calendar day using Date.UTC to handle month/year rollovers.
    const prev = new Date(Date.UTC(year, month - 1, day - 1));
    year  = prev.getUTCFullYear();
    month = prev.getUTCMonth() + 1;
    day   = prev.getUTCDate();
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Stage values we map 1:1 into the sleep_stages enum. */
const KNOWN_STAGE_TYPES = new Set(["deep", "light", "rem", "awake"]);

/**
 * Batch entry point: normalizes every session block, dropping any that lack a
 * usable interval. Unknown stage values still surface a per-session warning
 * from {@link normalizeGoogleSleepSession} before falling back to "light".
 */
export function normalizeGoogleSleepSessions(
  userId: string,
  blocks: GoogleHealthSessionBlock[]
): Array<NonNullable<ReturnType<typeof normalizeGoogleSleepSession>>> {
  return blocks
    .map((block) => normalizeGoogleSleepSession(userId, block))
    .filter((n): n is NonNullable<typeof n> => n !== null);
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

  // Derive sleepDate from the user's local wall-clock time, not the UTC date.
  // interval.startUtcOffset (e.g. "3600s") converts the UTC timestamp to the
  // user's local timezone; sessions starting before NIGHT_BOUNDARY_HOUR local
  // (e.g. 01:06) belong to the prior evening's night, not the early-morning day.
  const offsetSeconds = sleepData.interval.startUtcOffset
    ? parseInt(sleepData.interval.startUtcOffset, 10)
    : 0;
  const sleepDate = nightOf(startTime.getTime(), offsetSeconds);
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

  const unmappedTypes = new Map<string, number>();

  const stages = (sleepData.stages || []).map((stage) => {
    const sTime = new Date(stage.startTime);
    const eTime = new Date(stage.endTime);
    const durationMs = eTime.getTime() - sTime.getTime();

    const rawType = stage.type?.toLowerCase() ?? "";
    let stageType: "deep" | "light" | "rem" | "awake";
    if (KNOWN_STAGE_TYPES.has(rawType)) {
      stageType = rawType as "deep" | "light" | "rem" | "awake";
    } else {
      // Unknown stage value — surface it instead of silently absorbing it,
      // then fall back to "light" so the sync still completes.
      unmappedTypes.set(stage.type, (unmappedTypes.get(stage.type) ?? 0) + 1);
      stageType = "light";
    }

    return {
      id: crypto.randomUUID(),
      sessionId,
      stageType,
      startTime: sTime,
      endTime: eTime,
      durationMs,
    };
  });

  for (const [rawValue, count] of unmappedTypes) {
    console.warn(
      `[normalizer] Unmapped sleep stage type ${JSON.stringify(rawValue)} × ${count} in session ${sleepDate} — classified as "light"`
    );
  }

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

// ---------------------------------------------------------------------------
// Intra-day heart rate sample normalizer
// ---------------------------------------------------------------------------

/** One raw point from the `heart-rate` (sample) data type. */
export interface GoogleHealthHeartRateSamplePoint {
  heartRate?: {
    sampleTime?: { physicalTime?: string };
    /** Returned as a string (int64 in the API spec). */
    beatsPerMinute?: string;
  };
}

export interface NormalizedHeartRateSample {
  userId: string;
  timestamp: Date;
  bpm: number;
}

/**
 * Converts raw `heart-rate` sample points into rows for `heart_rate_samples`.
 * Drops points missing a physicalTime or with implausible bpm values, and
 * sorts ascending by timestamp.
 */
export function normalizeHeartRateSamples(
  userId: string,
  points: GoogleHealthHeartRateSamplePoint[]
): NormalizedHeartRateSample[] {
  const samples: NormalizedHeartRateSample[] = [];

  for (const point of points) {
    const iso = point.heartRate?.sampleTime?.physicalTime;
    if (!iso) continue;
    const timestamp = new Date(iso);
    if (isNaN(timestamp.getTime())) continue;

    const bpm = parseInt(String(point.heartRate?.beatsPerMinute ?? ""), 10);
    if (isNaN(bpm) || bpm < 20 || bpm > 300) continue;

    samples.push({ userId, timestamp, bpm });
  }

  return samples.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
