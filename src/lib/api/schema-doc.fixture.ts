// npx tsx src/lib/api/schema-doc.fixture.ts
// Drift guard: builds real payloads (including a fully scored night with stored HR
// samples) and fails if a returned field is undocumented, a documented field never
// appears, a unit or primitive type disagrees, or an enum value is undocumented.
import { assembleDashboardData, type SleepSessionRow } from "@/lib/sync/assemble";
import { buildDayData, type DayInput, type SessionInput } from "./day";
import { buildStateData } from "./state";
import { buildSuccess, buildFailure } from "./envelope";
import { SCHEMA_DOC } from "./schema-doc";
import type { SyncResponseData } from "./sync-response";
import { validateAgainstDoc, validateEnvelope, validateMetricShapes, type Json } from "./validate";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
function mustBeClean(errs: string[]): void { if (errs.length > 0) throw new Error(`Assertion failed:\n  ${errs.join("\n  ")}`); }
const json = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json;

// ── a real, fully scored night through the real engines, with HR samples ──
const HOUR = 3_600_000;
const t0 = Date.UTC(2026, 9, 26, 22, 0, 0);
const stages = [
  { stageType: "light" as const, startTime: new Date(t0), endTime: new Date(t0 + 2 * HOUR), durationMs: 2 * HOUR },
  { stageType: "deep" as const, startTime: new Date(t0 + 2 * HOUR), endTime: new Date(t0 + 3.5 * HOUR), durationMs: 1.5 * HOUR },
  { stageType: "rem" as const, startTime: new Date(t0 + 3.5 * HOUR), endTime: new Date(t0 + 5.5 * HOUR), durationMs: 2 * HOUR },
  { stageType: "awake" as const, startTime: new Date(t0 + 5.5 * HOUR), endTime: new Date(t0 + 6 * HOUR), durationMs: 0.5 * HOUR },
  { stageType: "light" as const, startTime: new Date(t0 + 6 * HOUR), endTime: new Date(t0 + 8 * HOUR), durationMs: 2 * HOUR },
];
const row = (sleepDate: string, shift: number): SleepSessionRow => ({
  sleepDate, startTime: new Date(t0 + shift), endTime: new Date(t0 + shift + 8 * HOUR), totalSleepMs: 7.5 * HOUR,
  efficiencyScore: 0.9, startUtcOffsetSeconds: 0, endUtcOffsetSeconds: 0,
  stages: stages.map((s) => ({ ...s, startTime: new Date(s.startTime.getTime() + shift), endTime: new Date(s.endTime.getTime() + shift) })),
});
const sessions: SleepSessionRow[] = Array.from({ length: 6 }, (_, i) => row(`2026-10-${26 - i}`, -i * 24 * HOUR));
const heartRows = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-${27 - i}`, restingHeartRate: 60, hrvRmssd: 40 }));
const samples = Array.from({ length: 480 }, (_, m) => ({ timestamp: new Date(t0 + m * 60_000), bpm: 52 }));
const assembled = assembleDashboardData(sessions, heartRows, samples);
if (!assembled.hasData) throw new Error("assembled");

const toInput = (r: SleepSessionRow): SessionInput => ({
  sleepDate: r.sleepDate, startMs: r.startTime.getTime(), endMs: r.endTime.getTime(), startUtcOffsetSeconds: 0, endUtcOffsetSeconds: 0,
  totalSleepMs: r.totalSleepMs, efficiencyScore: r.efficiencyScore,
  stages: r.stages.map((s) => ({ stageType: s.stageType, startMs: s.startTime.getTime(), endMs: s.endTime.getTime(), durationMs: s.durationMs })),
});
const nap: SessionInput = { ...toInput(sessions[0]), startMs: t0 + 16 * HOUR, endMs: t0 + 17 * HOUR, totalSleepMs: 0.9 * HOUR };
const full: DayInput = {
  date: "2026-10-27", today: "2026-10-28", syncedThrough: "2026-10-28",
  nightSessions: [toInput(sessions[0]), nap],
  lastNight: assembled.lastNight, nightHeart: assembled.nightHeart, cardiacStrain: assembled.cardiacStrain,
  hasNightSamples: true, restingHeartRate: 60, hrv: 40,
  activity: { steps: 1, light: 1, moderate: 1, vigorous: 1, peak: 1 },
};
const recorded = buildDayData(full);
const missing = buildDayData({ ...full, nightSessions: [], lastNight: null, nightHeart: null, cardiacStrain: null, hasNightSamples: false, restingHeartRate: null, hrv: null, activity: null });
// Same night with no stored samples: HR-estimated fields become unavailable, units unchecked there.
const noSamples = buildDayData({ ...full, cardiacStrain: null, hasNightSamples: false });

assert(recorded.sleep.main.status === "recorded" && recorded.sleep.main.scoreBreakdown.length === 5, "sample is a fully scored night");
assert(recorded.sleep.main.status === "recorded" && recorded.sleep.main.restlessness.restlessEvents.status === "estimated", "sample has an estimated metric");
assert(recorded.sleep.main.status === "recorded" && recorded.sleep.main.cardiacStrain.strainRecoveryScore.status === "derived", "sample has cardiac strain");

// ── day ── (requireAll across the union of samples)
mustBeClean(validateAgainstDoc("day", SCHEMA_DOC.responses.day, [json(recorded), json(missing), json(noSamples)], { requireAll: true }));
for (const d of [recorded, missing, noSamples]) mustBeClean(validateMetricShapes(json(d)));

// ── days wrapper ──
const daysPayload = { from: "2026-10-27", to: "2026-10-27", days: [recorded] };
mustBeClean(validateAgainstDoc("days", SCHEMA_DOC.responses.days, [json({ from: daysPayload.from, to: daysPayload.to })], { requireAll: false }));
assert(Array.isArray(daysPayload.days), "days wrapper holds an array of day payloads");

// ── state ── (populated debt/variance so metric units are compared)
const state = buildStateData({
  debt: assembled.currentState.debt, variance: assembled.currentState.variance, debtTargetHours: 8,
  lastSyncedAtMs: Date.UTC(2026, 9, 27, 7, 0, 0), syncedThrough: "2026-10-27", serverOffsetSeconds: 0,
  google: { linked: true, hasRefreshToken: true, accessTokenExpiresAtSec: 1 },
});
mustBeClean(validateAgainstDoc("state", SCHEMA_DOC.responses.state, [json(state)], { requireAll: true }));

// ── sync ──
const syncSample: SyncResponseData = { status: "error", stepsRun: 0, syncedThrough: null, lastSyncedAt: null, message: "x" };
mustBeClean(validateAgainstDoc("sync", SCHEMA_DOC.responses.sync, [json(syncSample)], { requireAll: true }));

// ── envelope ──
const clock = { nowMs: 0, offsetSeconds: 0, timezone: "UTC" };
mustBeClean(validateAgainstDoc("envelope", SCHEMA_DOC.responses.envelope, [json(buildSuccess({}, clock)), json(buildFailure("internal_error", "x")), json(buildFailure("cooldown", "x", { retryAfterSeconds: 60 }))], { requireAll: true }));
assert(validateEnvelope(json(buildSuccess({}, clock))).errors.length === 0, "success envelope validates");

// ── schema's own top-level shape ──
assert(
  Object.keys(SCHEMA_DOC).sort().join() === Object.keys(SCHEMA_DOC.responses.schema).sort().join(),
  "schema response catalogue lists exactly the SchemaDoc top-level keys",
);

// ── prose for every table entry; endpoints reference a catalogue ──
for (const group of [SCHEMA_DOC.unavailableReasons, SCHEMA_DOC.metricStatuses, SCHEMA_DOC.errorCodes, SCHEMA_DOC.syncStatuses, SCHEMA_DOC.metricFlags]) {
  for (const [k, v] of Object.entries(group)) assert(v.length > 20, `"${k}" needs a description`);
}
for (const e of SCHEMA_DOC.endpoints) assert(e.response in SCHEMA_DOC.responses, `endpoint ${e.path} response key`);
for (const [name, docs] of Object.entries(SCHEMA_DOC.responses)) {
  for (const [p, d] of Object.entries(docs)) {
    assert(d.description.length > 20, `${name}.${p} needs a real description`);
    if (d.kind === "enum") assert(Array.isArray(d.values) && d.values.length > 0, `${name}.${p} enum must list its values`);
  }
}

console.log("schema-doc fixture: all assertions passed");
