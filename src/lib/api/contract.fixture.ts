// npx tsx src/lib/api/contract.fixture.ts
import { assembleDashboardData, type SleepSessionRow } from "@/lib/sync/assemble";
import { buildDayData, type DayInput, type SessionInput } from "./day";
import { buildFailure, buildSuccess, isApiFailure } from "./envelope";
import { buildStateData } from "./state";
import { formatInstantWithOffset, formatOffset } from "./time";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

// ── time ──
assert(formatInstantWithOffset(0, 0) === "1970-01-01T00:00:00+00:00", "epoch utc");
assert(formatInstantWithOffset(0, 3600) === "1970-01-01T01:00:00+01:00", "positive offset");
assert(formatInstantWithOffset(0, -5 * 3600 - 1800) === "1969-12-31T18:30:00-05:30", "negative half-hour offset crosses midnight");
assert(formatOffset(19800) === "+05:30", "offset format");

// ── envelope ──
const ok = buildSuccess({ x: 1 }, { nowMs: Date.UTC(2026, 9, 27, 12, 0, 0), offsetSeconds: 3600, timezone: "Europe/Oslo" });
assert(ok.apiVersion === "1" && ok.generatedAt === "2026-10-27T13:00:00+01:00" && ok.timezone === "Europe/Oslo" && !isApiFailure(ok), "success envelope");
const bad = buildFailure("range_too_large", "too big");
assert(isApiFailure(bad) && bad.error.code === "range_too_large" && bad.apiVersion === "1", "failure envelope");

// ── a realistic night through the real engines ──
const HOUR = 3_600_000;
const start = Date.UTC(2026, 9, 26, 22, 0, 0); // night of 2026-10-26 (UTC clock; offset 0 here)
const mkStages = (t0: number) => [
  { stageType: "light" as const, startTime: new Date(t0), endTime: new Date(t0 + 2 * HOUR), durationMs: 2 * HOUR },
  { stageType: "deep" as const, startTime: new Date(t0 + 2 * HOUR), endTime: new Date(t0 + 3.5 * HOUR), durationMs: 1.5 * HOUR },
  { stageType: "rem" as const, startTime: new Date(t0 + 3.5 * HOUR), endTime: new Date(t0 + 5.5 * HOUR), durationMs: 2 * HOUR },
  { stageType: "awake" as const, startTime: new Date(t0 + 5.5 * HOUR), endTime: new Date(t0 + 6 * HOUR), durationMs: 0.5 * HOUR },
  { stageType: "light" as const, startTime: new Date(t0 + 6 * HOUR), endTime: new Date(t0 + 8 * HOUR), durationMs: 2 * HOUR },
];
const row = (sleepDate: string, t0: number, hours: number, stages = mkStages(t0)): SleepSessionRow => ({
  sleepDate, startTime: new Date(t0), endTime: new Date(t0 + hours * HOUR), totalSleepMs: (hours - 0.5) * HOUR,
  efficiencyScore: 0.9, startUtcOffsetSeconds: 0, endUtcOffsetSeconds: 0, stages,
});
const sessions: SleepSessionRow[] = [row("2026-10-26", start, 8), row("2026-10-25", start - 24 * HOUR, 7.5)];
const heartRows = [
  { date: "2026-10-27", restingHeartRate: 60, hrvRmssd: 40 },
  { date: "2026-10-26", restingHeartRate: 61, hrvRmssd: 42 },
  { date: "2026-10-25", restingHeartRate: 62, hrvRmssd: 41 },
];
const assembled = assembleDashboardData(sessions, heartRows);
assert(assembled.hasData, "assembled");
const lastNight = assembled.hasData ? assembled.lastNight : null;
const toInput = (r: SleepSessionRow): SessionInput => ({
  sleepDate: r.sleepDate, startMs: r.startTime.getTime(), endMs: r.endTime.getTime(),
  startUtcOffsetSeconds: r.startUtcOffsetSeconds ?? null, endUtcOffsetSeconds: r.endUtcOffsetSeconds ?? null,
  totalSleepMs: r.totalSleepMs, efficiencyScore: r.efficiencyScore,
  stages: r.stages.map((s) => ({ stageType: s.stageType, startMs: s.startTime.getTime(), endMs: s.endTime.getTime(), durationMs: s.durationMs })),
});
const nap: SessionInput = { ...toInput(row("2026-10-26", start + 15 * HOUR, 1.0, [])), totalSleepMs: 0.8 * HOUR };

const base: DayInput = {
  date: "2026-10-27", today: "2026-10-28", syncedThrough: "2026-10-28",
  nightSessions: [nap, toInput(sessions[0])],
  lastNight,
  nightHeart: assembled.hasData ? assembled.nightHeart : null,
  cardiacStrain: assembled.hasData ? assembled.cardiacStrain : null,
  hasNightSamples: false,
  restingHeartRate: 60, hrv: 40,
  activity: { steps: 0, light: 900, moderate: 10, vigorous: 2, peak: 1 },
};
const day = buildDayData(base);

if (day.sleep.main.status !== "recorded") throw new Error("main night expected");
const main = day.sleep.main;
assert(lastNight !== null && main.score.status === "derived" && main.score.value === lastNight.holisticScore, "score equals the engine's holisticScore");
assert(main.isMain && main.stages.length === 5 && main.stages[0].start === "2026-10-26T22:00:00+00:00", "stages carry offset instants");
assert(day.sleep.naps.length === 1 && !day.sleep.naps[0].isMain, "nap listed separately, not as main");
assert(main.stageMinutes.deep.status === "measured" && main.stageMinutes.deep.value === 90, "deep minutes");
// No stored HR samples: HR-estimated fields say not_fetched, stage-derived ones stay available.
assert(main.restlessness.restlessEvents.status === "unavailable" && main.restlessness.restlessEvents.reason === "not_fetched", "restlessness est. not_fetched");
assert(main.restlessness.disruptionIndex.status === "derived", "stage-derived disruption available");
assert(main.cardiacStrain.strainRecoveryScore.status === "unavailable" && main.cardiacStrain.strainRecoveryScore.reason === "not_fetched", "no samples → not_fetched");
assert(main.nightHeart.restingHr.status === "measured" && main.nightHeart.restingHr.value === 60, "night RHR");
// Zeros are measurements.
assert(day.steps.status === "measured" && day.steps.value === 0, "0 steps stays measured");
// AZM = the dashboard card's math over stored zone minutes (10*1 + 2*2 + 1*2 = 16; light is not counted), derived, not measured.
assert(day.activeZoneMinutes.status === "derived", "AZM is derived (computed from zone minutes)");
assert("value" in day.activeZoneMinutes && day.activeZoneMinutes.value === 16 && day.activeZoneMinutes.unit === "min", "AZM value from calculateActiveZoneMinutes");
assert(!("flags" in day.activeZoneMinutes) || day.activeZoneMinutes.flags === undefined, "AZM on a past day has no partial_day flag");
assert(day.heartZoneMinutes.moderate.status === "measured", "heart zones stay measured");
const todayAzm = buildDayData({ ...base, date: base.today });
assert(todayAzm.activeZoneMinutes.status === "derived" && todayAzm.activeZoneMinutes.flags?.includes("partial_day") === true, "today's AZM carries partial_day");

// Absence: no sessions + covered date → not_worn; uncovered → not_synced; null AZM columns → unavailable, never 0.
const empty = buildDayData({ ...base, nightSessions: [], lastNight: null, nightHeart: null, cardiacStrain: null, restingHeartRate: null, hrv: null, activity: null });
assert(empty.sleep.main.status === "unavailable" && empty.sleep.main.reason === "not_worn", "covered, no data → not_worn");
assert(empty.restingHeartRate.status === "unavailable" && empty.steps.status === "unavailable" && empty.activeZoneMinutes.status === "unavailable", "no zeros for missing");
const future = buildDayData({ ...base, syncedThrough: "2026-10-20", nightSessions: [], lastNight: null, nightHeart: null, cardiacStrain: null, restingHeartRate: null, hrv: null, activity: null });
assert(future.sleep.main.status === "unavailable" && future.sleep.main.reason === "not_synced", "after cursor → not_synced");
const nullAzm = buildDayData({ ...base, activity: { steps: 500, light: null, moderate: null, vigorous: null, peak: null } });
assert(nullAzm.activeZoneMinutes.status === "unavailable" && nullAzm.activeZoneMinutes.reason === "not_worn" && !("value" in nullAzm.activeZoneMinutes) && nullAzm.steps.status === "measured", "NULL zone columns are unavailable (not_worn), no value, steps still measured");
// Partially NULL zones: AZM is unavailable (never computed from a subset) while the non-null heart zones stay measured.
const partialAzm = buildDayData({ ...base, activity: { steps: 500, light: 900, moderate: 10, vigorous: 2, peak: null } });
assert(partialAzm.activeZoneMinutes.status === "unavailable" && partialAzm.heartZoneMinutes.moderate.status === "measured" && partialAzm.heartZoneMinutes.peak.status === "unavailable", "partial NULL zones: AZM unavailable, other zones measured");
// A main session whose night could not be scored says insufficient_data (not "not_supported").
const unscored = buildDayData({ ...base, lastNight: null, nightHeart: null, cardiacStrain: null });
if (unscored.sleep.main.status !== "recorded") throw new Error("recorded expected");
assert(unscored.sleep.main.score.status === "unavailable" && unscored.sleep.main.score.reason === "insufficient_data", "unscored → insufficient_data");
// A nap bigger than main is chosen by the engine rule, not a local copy.
const bigNap = buildDayData({ ...base, nightSessions: [{ ...nap, totalSleepMs: 20 * HOUR }, toInput(sessions[0])] });
assert(bigNap.sleep.main.status === "recorded" && bigNap.sleep.main.totalSleep.status === "measured" && bigNap.sleep.main.totalSleep.value === 1200, "main chosen by selectMainSessions rule");
// Today: accumulating values flagged partial.
const today = buildDayData({ ...base, date: "2026-10-28" });
assert(today.steps.status === "measured" && JSON.stringify(today.steps.flags) === '["partial_day"]', "today's steps partial_day");

// ── state ──
const st = buildStateData({
  debt: assembled.hasData ? assembled.currentState.debt : null,
  variance: assembled.hasData ? assembled.currentState.variance : null,
  debtTargetHours: 8, lastSyncedAtMs: Date.UTC(2026, 9, 27, 7, 0, 0), syncedThrough: "2026-10-27",
  serverOffsetSeconds: 3600, google: { linked: true, hasRefreshToken: true, accessTokenExpiresAtSec: null },
});
assert(st.sync.lastSyncedAt === "2026-10-27T08:00:00+01:00", "lastSyncedAt with offset");
assert(st.circadianVariance.bedtimeStdDevMinutes.status === "unavailable" && st.circadianVariance.bedtimeStdDevMinutes.reason === "insufficient_data", "2 nights < minimum → insufficient_data, not not_synced");
assert(st.sleepDebt.cumulativeHours.status === "derived", "debt derived");

console.log("contract fixture: all assertions passed");
