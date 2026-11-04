// Machine-readable description of the /api/v1 contract, written for an AI reader.
// Pure. It lives beside the contract types, and schema-doc.fixture.ts walks real
// builder output to fail when a field exists without a description (or vice versa).

import type { MetricFlag, UnavailableReason } from "./metric";
import { MAX_RANGE_DAYS, type ApiErrorCode } from "./envelope";
import type { ApiSyncStatus } from "./sync-loop";

export interface EndpointDoc {
  method: "GET" | "POST";
  path: string;
  scope: "read" | "sync";
  summary: string;
  params: Array<{ name: string; required: boolean; type: string; description: string }>;
  /** Key into SchemaDoc.responses. */
  response: "day" | "days" | "state" | "sync" | "schema";
}

export interface FieldDoc {
  /** How to read the value. "metric" = a MetricValue object (see metricStatuses). */
  kind: "metric" | "string" | "number" | "boolean" | "instant" | "date" | "enum" | "object" | "array";
  unit?: string;
  /** For kind "enum": the values that may appear (checked against real output by the drift guard). */
  values?: string[];
  description: string;
  /** Present only in some variants/conditions; may be absent from a given response. */
  optional?: boolean;
}

export interface SchemaDoc {
  apiVersion: "1";
  conventions: string[];
  endpoints: EndpointDoc[];
  metricStatuses: Record<"measured" | "estimated" | "derived" | "unavailable", string>;
  metricFlags: Record<MetricFlag, string>;
  unavailableReasons: Record<UnavailableReason, string>;
  errorCodes: Record<ApiErrorCode, string>;
  syncStatuses: Record<ApiSyncStatus, string>;
  /** Field catalogue per response, keyed by dotted path ("[]" marks array elements). */
  responses: Record<"envelope" | "day" | "days" | "state" | "sync" | "schema", Record<string, FieldDoc>>;
}

const M = (description: string, unit: string, optional = false): FieldDoc => ({ kind: "metric", unit, description, ...(optional ? { optional } : {}) });

const SESSION_FIELDS = (p: string): Record<string, FieldDoc> => ({
  [`${p}.nightOf`]: { kind: "date", description: "Local date the night STARTED (sleep sessions are keyed by start date). The night for calendar day D has nightOf = D minus 1." },
  [`${p}.start`]: { kind: "instant", description: "Session start, ISO 8601 with the UTC offset the person was on (+00:00 if the source gave no offset)." },
  [`${p}.end`]: { kind: "instant", description: "Session end, same format." },
  [`${p}.isMain`]: { kind: "boolean", description: "True for the night's main session; false for naps." },
  [`${p}.totalSleep`]: M("Time actually asleep (excludes awake time).", "min"),
  [`${p}.timeInBed`]: M("End minus start of the session.", "min"),
  [`${p}.efficiency`]: M("The source's own sleep-efficiency figure (0 to 1), frozen at sync time. It can differ from totalSleep divided by timeInBed. The sleep score does NOT use it; its efficiency component uses totalSleep / timeInBed.", "ratio"),
  [`${p}.stageMinutes.deep`]: M("Minutes in deep sleep. Unavailable (insufficient_data) when the session has no stage data. Stage minutes are rounded individually, so they may differ from totalSleep by a minute or two.", "min"),
  [`${p}.stageMinutes.light`]: M("Minutes in light sleep.", "min"),
  [`${p}.stageMinutes.rem`]: M("Minutes in REM sleep.", "min"),
  [`${p}.stageMinutes.awake`]: M("Minutes awake during the session.", "min"),
  [`${p}.stages[].stage`]: { kind: "enum", description: "One of deep, light, rem, awake.", values: ["deep", "light", "rem", "awake"] },
  [`${p}.stages[].start`]: { kind: "instant", description: "Stage interval start (ISO 8601 with offset)." },
  [`${p}.stages[].end`]: { kind: "instant", description: "Stage interval end (ISO 8601 with offset)." },
  [`${p}.stages[].minutes`]: { kind: "number", unit: "min", description: "Interval length, rounded to whole minutes. Rounded individually, so sums can differ from totals by a minute or two." },
});

export const SCHEMA_DOC: SchemaDoc = {
  apiVersion: "1",
  conventions: [
    "Authenticate every request with 'Authorization: Bearer <token>'. A session cookie never works. Reads need scope 'read'; POST /api/v1/sync needs scope 'sync'.",
    "Every response is JSON in one envelope: success {apiVersion, generatedAt, timezone, data}, failure {apiVersion, error:{code, message}}. Check for the 'error' key.",
    "Calendar dates are local YYYY-MM-DD strings in 'timezone' (the server's). Instants are ISO 8601 with a UTC offset.",
    "Every measurement and derived quantity is a metric object with a 'status'. Bookkeeping counts and weights (nights, stepsRun, score weights, stage minutes inside a stage list) are plain numbers (kind 'number'). Never treat a missing or unavailable value as zero: a measured 0 is a real zero, 'unavailable' means no value exists and 'reason' says why.",
    "A calendar day D shows the night that ENDED the morning of D (the session whose nightOf is D minus 1), plus D's own resting heart rate, HRV, steps and heart-zone minutes and active zone minutes.",
    "Read endpoints only read the database. They never trigger a sync or contact Google; use POST /api/v1/sync for that.",
  ],
  endpoints: [
    {
      method: "GET", path: "/api/v1/day", scope: "read", response: "day",
      summary: "One calendar day: the night's main session and naps, stages, sleep score and breakdown, night heart summary, restlessness estimate, resting HR, HRV, steps and heart-zone minutes and active zone minutes.",
      params: [{ name: "date", required: false, type: "YYYY-MM-DD", description: "Calendar day. Defaults to today in the server's timezone." }],
    },
    {
      method: "GET", path: "/api/v1/days", scope: "read", response: "days",
      summary: `Returns {from, to, days:[...]}, where each element has the same shape as /day, ascending by date. At most ${MAX_RANGE_DAYS} days inclusive; longer ranges fail with range_too_large.`,
      params: [
        { name: "from", required: true, type: "YYYY-MM-DD", description: "First day, inclusive." },
        { name: "to", required: true, type: "YYYY-MM-DD", description: "Last day, inclusive; not before 'from'." },
      ],
    },
    {
      method: "GET", path: "/api/v1/state", scope: "read", response: "state",
      summary: "Current sleep debt, circadian (bedtime) variance, and sync status including what is known about the Google link.",
      params: [],
    },
    {
      method: "POST", path: "/api/v1/sync", scope: "sync", response: "sync",
      summary: "Runs the catch-up sync in a server-side loop (at most 8 steps or 45 seconds) and returns where it ended. The only write endpoint. Safe to call repeatedly; returns 'fresh' without contacting Google when nothing is due.",
      params: [],
    },
    {
      method: "GET", path: "/api/v1/schema", scope: "read", response: "schema",
      summary: "This document.",
      params: [],
    },
  ],
  metricStatuses: {
    measured: "Reported directly by the device or its cloud. Has value and unit. May carry flags.",
    estimated: "Inferred from other measurements with an approximation; 'method' says how. Treat as less certain than measured.",
    derived: "Computed by this app from stored measurements (scores, baselines, totals). Exact given the inputs, but only as meaningful as those inputs.",
    unavailable: "No value exists. 'reason' says why. This is not zero.",
  },
  metricFlags: {
    partial_day: "The value belongs to today and is still accumulating; it can increase until the day ends.",
  },
  unavailableReasons: {
    not_worn: "The day is covered by the sync cursor (on or before synced_through) but the device recorded nothing: it was not worn or had no data.",
    not_synced: "The day is after the sync cursor (or the cursor is unknown). Data may exist at the source but has not been fetched yet; POST /api/v1/sync can help.",
    not_fetched: "The value depends on data that is only fetched on demand (for example minute-level overnight heart-rate samples) and it is not stored locally. Read endpoints never fetch it.",
    not_supported: "Reserved: the source does not provide this metric. The current API does not emit it yet.",
    partial_day: "Reserved: the day is not over, so a final value cannot exist yet. The current API marks today's accumulating values with the partial_day flag instead of this reason.",
    insufficient_data: "The inputs exist but are too thin to compute this: fewer nights or readings than the metric needs, or the night could not be scored. More syncing will not help by itself; more history (or complete data for that night) will.",
  },
  errorCodes: {
    unauthorized: "Missing, invalid, or revoked bearer token (HTTP 401).",
    insufficient_scope: "The token is valid but lacks the required scope (HTTP 403).",
    invalid_parameter: "A query parameter is missing or malformed (HTTP 400).",
    range_too_large: `The requested range exceeds ${MAX_RANGE_DAYS} days (HTTP 400).`,
    not_found: "Unknown route (HTTP 404).",
    internal_error: "The server failed to answer; retry later (HTTP 500).",
  },
  syncStatuses: {
    fresh: "Nothing was due (last sync is recent and there is no gap). No Google call was made.",
    synced: "Work was done and nothing more is due.",
    pending: "More work remains (step/time cap reached) or another sync holds the lock. Call again later.",
    auth_required: "Google sign-in expired; the person must reconnect in the web app. Retrying will not help.",
    error: "A step failed; see 'message'. Progress made before the failure is kept.",
  },
  responses: {
    envelope: {
      apiVersion: { kind: "string", description: "Always \"1\" for this contract." },
      generatedAt: { kind: "instant", description: "When the response was produced, ISO 8601 with the server's UTC offset.", optional: true },
      timezone: { kind: "string", description: "IANA zone of the server; calendar dates and generatedAt offset belong to it.", optional: true },
      data: { kind: "object", description: "The endpoint payload (success only).", optional: true },
      "error.code": { kind: "enum", description: "Machine-readable error code; see errorCodes (failure only).", optional: true, values: ["unauthorized", "insufficient_scope", "invalid_parameter", "range_too_large", "not_found", "internal_error"] },
      "error.message": { kind: "string", description: "Human-readable explanation (failure only).", optional: true },
    },
    days: {
      from: { kind: "date", description: "First day of the range, as requested." },
      to: { kind: "date", description: "Last day of the range, as requested." },
      "days[]": { kind: "array", description: "One element per calendar day, ascending; each has exactly the shape documented under the day response." },
    },
    schema: {
      apiVersion: { kind: "string", description: "Contract version of this API; currently the string \"1\"." },
      conventions: { kind: "array", description: "Rules that apply to every endpoint." },
      endpoints: { kind: "array", description: "Every endpoint with method, path, scope, summary, params and response key." },
      metricStatuses: { kind: "object", description: "Meaning of measured, estimated, derived and unavailable." },
      metricFlags: { kind: "object", description: "Meaning of value flags such as partial_day." },
      unavailableReasons: { kind: "object", description: "Meaning of each reason an unavailable value can carry." },
      errorCodes: { kind: "object", description: "Meaning of each error code." },
      syncStatuses: { kind: "object", description: "Meaning of each POST /api/v1/sync status." },
      responses: { kind: "object", description: "Field catalogue per response, keyed by dotted path." },
    },
    day: {
      date: { kind: "date", description: "The calendar day requested." },
      "sleep.main": { kind: "object", optional: true, description: "The night that ended the morning of 'date'. Either a recorded night (status 'recorded', all fields below) or {status:'unavailable', reason} when no session exists (reason is not_worn or not_synced)." },
      "sleep.main.status": { kind: "enum", description: "'recorded', or 'unavailable' for a missing night.", optional: true, values: ["recorded", "unavailable"] },
      "sleep.main.reason": { kind: "enum", description: "Why the night is missing (not_worn or not_synced); only when status is 'unavailable'.", optional: true, values: ["not_worn", "not_synced"] },
      ...SESSION_FIELDS("sleep.main"),
      "sleep.main.score": M("Holistic sleep score, 0 to 100, identical to the dashboard's for this night. Weighted mean of five component sub-scores with nominal weights volume 0.30, efficiency 0.15, continuity 0.20, disruption 0.20, cardiac 0.15. Volume = total sleep / 8 h, capped at 100. Efficiency = (totalSleep / timeInBed) / 0.95, capped at 100. Continuity = deep-sleep consolidation. Disruption = the disruption index. Cardiac = intra-night strain recovery score if heart-rate samples are stored, else the daily RHR/HRV recovery score, else absent. Absent components drop out and the remaining weights are renormalised to sum to 1. Unavailable when the night could not be scored (no stage data).", "score"),
      "sleep.main.scoreBreakdown[].key": { kind: "enum", description: "volume, efficiency, continuity, disruption or cardiac.", values: ["volume", "efficiency", "continuity", "disruption", "cardiac"] },
      "sleep.main.scoreBreakdown[].present": { kind: "boolean", description: "False when the component could not be computed and its weight was redistributed to the others." },
      "sleep.main.scoreBreakdown[].subScore": M("This component's 0-100 sub-score. For an absent component it is unavailable with reason not_fetched, which here just means 'component absent'. The array holds all five components when the night was scored and is empty otherwise.", "score"),
      "sleep.main.scoreBreakdown[].weight": { kind: "number", unit: "fraction", description: "Effective weight (0 to 1) after renormalising over present components; present weights sum to 1; 0 for an absent component." },
      "sleep.main.scoreBreakdown[].contribution": { kind: "number", unit: "score", description: "Points this component contributed to the score (subScore times weight); the present contributions sum to the score within rounding; 0 for an absent component." },
      "sleep.main.restlessness.source": { kind: "enum", description: "'hr-estimated' when intra-night heart-rate samples were stored and used; 'none' otherwise.", values: ["hr-estimated", "none"] },
      "sleep.main.restlessness.restlessEvents": M("Count of brief restless stirs during sleep, estimated from transient heart-rate spikes: a minute counts as elevated when it is more than 6 bpm above the rolling median of the surrounding +/-5 minutes; runs of 4 minutes or less become an event; minutes within 2 minutes of an awake stage block are ignored. Only exists when intra-night heart-rate samples are stored; otherwise unavailable (not_fetched), or insufficient_data if samples exist but could not be used.", "count"),
      "sleep.main.restlessness.restlessMinutes": M("Total minutes of those restless stirs (same estimate).", "min"),
      "sleep.main.restlessness.awakenings": M("Count of true mid-night awakenings taken from the sleep stages (awake intervals of 5 minutes or more). Awake time before first sleep or after the final wake-up is not counted.", "count"),
      "sleep.main.restlessness.awakeMinutes": M("Total minutes of those awakenings.", "min"),
      "sleep.main.restlessness.disruptionIndex": M("0 to 100, where 100 = no mid-night disruption: 100 minus (3 per restless stir + 10 per awakening + 1 per mid-night awake minute), clamped to 0-100.", "score"),
      "sleep.main.nightHeart.restingHr": M("The resting heart rate dated the morning after the night (the wake-up day's daily value).", "bpm"),
      "sleep.main.nightHeart.hrv": M("The HRV (RMSSD) dated the morning after the night.", "ms"),
      "sleep.main.nightHeart.baselineRhr": M("Baseline resting heart rate used for comparison: the mean of up to the 7 daily readings before the wake-up day (excluding it); needs at least 3 readings, else unavailable (insufficient_data).", "bpm"),
      "sleep.main.nightHeart.baselineHrv": M("Baseline HRV: same rule as baselineRhr.", "ms"),
      "sleep.main.nightHeart.recoveryScore": M("0 to 100 cardiac recovery from the daily RHR/HRV against their baselines: RHR component = 100 minus 4 per percent above baseline; HRV component = 100 minus 3 per percent below baseline; the score is the mean of the components that exist. 100 = at or better than baseline.", "score"),
      "sleep.main.nightHeart.status": { kind: "enum", description: "recovering (recoveryScore 85 or more), typical, strained (below 60), or insufficient (no baseline to compare against).", values: ["recovering", "typical", "strained", "insufficient"] },
      "sleep.main.cardiacStrain.avgAsleepBpm": M("Mean heart rate while asleep (non-awake stages), estimated from stored minute-level samples. Unavailable (not_fetched) when no samples are stored.", "bpm"),
      "sleep.main.cardiacStrain.timeBelowBaselinePct": M("Share of asleep minutes with heart rate at or below the resting baseline.", "percent"),
      "sleep.main.cardiacStrain.strainRecoveryScore": M("0 to 100 intra-night recovery score: timeBelowBaselinePct / 60 x 100, clamped (100 when at least 60% of asleep time is at or below the resting baseline). Needs at least 30 asleep minutes of samples and a baseline. It is the preferred source for the cardiac component of the sleep score.", "score"),
      ...SESSION_FIELDS("sleep.naps[]"),
      restingHeartRate: M("Resting heart rate for this calendar day (the daily value the device reports).", "bpm"),
      hrv: M("Overnight HRV (RMSSD) for this calendar day.", "ms"),
      steps: M("Step total for the day. For today it is flagged partial_day.", "steps"),
      activeZoneMinutes: M("Active zone minutes, the same figure as the dashboard card: computed from Google's per-day Karvonen zone minutes (moderate x1, vigorous and peak x2; light does not count). It matches Google's own active-zone-minutes data within about 2 minutes, not exactly (checked on 12 sampled days), so treat it as an estimate-grade figure. Unavailable when the day has no stored zone minutes. Today's value carries the partial_day flag.", "min"),
      "heartZoneMinutes.light": M("Minutes in the 'light' zone of Google's per-day Karvonen heart-rate zones (computed from that day's resting and maximum heart rate), NOT Fitbit's fat-burn/cardio/peak zones, so the names and thresholds do not match the Fitbit app. 'Light' is the lowest zone and covers most worn time by design (ordinary walking and resting-but-awake time fall in it), so a large value is expected; it is not an activity measure. Today's zone minutes carry the partial_day flag.", "min"),
      "heartZoneMinutes.moderate": M("Minutes in the 'moderate' zone of Google's per-day Karvonen heart-rate zones (computed from that day's resting and maximum heart rate), NOT Fitbit's fat-burn/cardio/peak zones, so the names and thresholds do not match the Fitbit app. Today's value carries the partial_day flag.", "min"),
      "heartZoneMinutes.vigorous": M("Minutes in the 'vigorous' zone of Google's per-day Karvonen heart-rate zones (computed from that day's resting and maximum heart rate), NOT Fitbit's fat-burn/cardio/peak zones, so the names and thresholds do not match the Fitbit app. Today's value carries the partial_day flag.", "min"),
      "heartZoneMinutes.peak": M("Minutes in the 'peak' zone of Google's per-day Karvonen heart-rate zones (computed from that day's resting and maximum heart rate), NOT Fitbit's fat-burn/cardio/peak zones, so the names and thresholds do not match the Fitbit app. Today's value carries the partial_day flag.", "min"),
    },
    state: {
      "sleepDebt.cumulativeHours": M("Sleep debt in hours over the most recent 14 main sessions (naps excluded) against an 8 h target. Each night's difference (target minus slept) is weighted by 0.5^(age in days / 4), a 4-day half-life measured back from the newest night; surplus counts at half weight; the total is floored at 0.", "hours"),
      "sleepDebt.severity": { kind: "enum", description: "optimal (under 5 h), moderate (5 to 10 h) or high (over 10 h); null when there is no data.", values: ["optimal", "moderate", "high"] },
      "sleepDebt.nightsUsed": { kind: "number", unit: "nights", description: "Recorded nights the figure is based on (not calendar days)." },
      "sleepDebt.windowSpanDays": { kind: "number", unit: "days", description: "Calendar days from the oldest to the newest night used, inclusive." },
      "sleepDebt.targetHoursPerNight": { kind: "number", unit: "hours", description: "The sleep target the debt is measured against." },
      "circadianVariance.bedtimeStdDevMinutes": M("Standard deviation of bedtime (whole minutes) over the most recent 14 main sessions; higher = less regular. Bedtime is read on the local clock of that night's stored UTC offset (so a timezone change alone does not register), and bedtimes after 12:00 are treated as before midnight. Needs at least 5 nights, else unavailable (insufficient_data).", "min"),
      "circadianVariance.averageBedtimeMinutesFromMidnight": M("Average bedtime as minutes from midnight (negative = before midnight).", "min"),
      "circadianVariance.status": { kind: "enum", description: "stable (std dev up to 30 min), variable (above 30 up to 75), erratic (above 75); null when unavailable.", values: ["stable", "variable", "erratic"] },
      "circadianVariance.nights": { kind: "number", unit: "nights", description: "Nights the variance was computed from." },
      "sync.lastSyncedAt": { kind: "instant", description: "When the last successful recent-window sync finished; null if never." },
      "sync.syncedThrough": { kind: "date", description: "Latest date up to which synced coverage is contiguous; days after it may exist at the source but are not fetched. Null = not tracked." },
      "sync.google.linked": { kind: "boolean", description: "A Google account is linked." },
      "sync.google.hasRefreshToken": { kind: "boolean", description: "A refresh token is stored, so access can renew without the person." },
      "sync.google.accessTokenExpiresAt": { kind: "instant", description: "Stored access-token expiry; expiry alone is not a failure, it renews on use. Null if unknown." },
      "sync.google.note": { kind: "string", description: "Why auth validity cannot be confirmed without contacting Google." },
    },
    sync: {
      status: { kind: "enum", values: ["fresh", "synced", "pending", "auth_required", "error"], description: "Outcome of the call; the meaning of each value is in syncStatuses. Branch on this, not the HTTP code (error and auth_required also answer 200)." },
      stepsRun: { kind: "number", unit: "steps", description: "Catch-up steps that did work in this call." },
      syncedThrough: { kind: "date", description: "Sync cursor after the call (see state.sync.syncedThrough)." },
      lastSyncedAt: { kind: "instant", description: "Last successful recent-window sync after the call; null if never." },
      message: { kind: "string", description: "Error detail when status is 'error'.", optional: true },
    },
  },
};
