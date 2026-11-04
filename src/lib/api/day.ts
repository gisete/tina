// The per-day payload of GET /api/v1/day and /api/v1/days — types and a pure
// builder. Primitives in, plain JSON out; no React/Next/DB imports. Every number
// is a MetricValue (src/lib/api/metric.ts). Derived values come from the
// existing sleep/activity engines via the inputs: nothing here re-does their math.

import { selectMainSessions, type CardiacStrain, type LastNightDetail, type NightHeartSummary, type SleepStageType } from "@/lib/analytics/sleep";
import { dayMetric, classifyAbsence, type AbsenceContext } from "./absence";
import { derived, estimated, measured, unavailable, type MetricValue, type UnavailableMetric } from "./metric";
import { formatInstantWithOffset } from "./time";

// ── Output types ───────────────────────────────────────────────────────────

export interface StageSpan {
  stage: SleepStageType;
  /** ISO 8601 with the offset the person was on. */
  start: string;
  end: string;
  minutes: number;
}

export interface SleepSessionData {
  /** Date the night started (the sleep_date key). */
  nightOf: string;
  start: string;
  end: string;
  isMain: boolean;
  totalSleep: MetricValue;
  timeInBed: MetricValue;
  /** Fraction 0-1: time asleep / time in bed, as stored by the source. */
  efficiency: MetricValue;
  stageMinutes: { deep: MetricValue; light: MetricValue; rem: MetricValue; awake: MetricValue };
  stages: StageSpan[];
}

export interface ScoreComponentData {
  key: "volume" | "efficiency" | "continuity" | "disruption" | "cardiac";
  present: boolean;
  /** 0-100 sub-score; unavailable when the component was absent for this night. */
  subScore: MetricValue;
  /** Fraction 0-1 after redistributing absent components' weight. */
  weight: number;
  /** Points this component contributed to the score. */
  contribution: number;
}

export interface MainNightData extends SleepSessionData {
  status: "recorded";
  /** Holistic sleep score 0-100, identical to the dashboard's. */
  score: MetricValue;
  scoreBreakdown: ScoreComponentData[];
  restlessness: {
    /** "hr-estimated" when intra-night HR samples existed; "none" otherwise. */
    source: "none" | "hr-estimated";
    restlessEvents: MetricValue;
    restlessMinutes: MetricValue;
    awakenings: MetricValue;
    awakeMinutes: MetricValue;
    disruptionIndex: MetricValue;
  };
  nightHeart: {
    restingHr: MetricValue;
    hrv: MetricValue;
    baselineRhr: MetricValue;
    baselineHrv: MetricValue;
    recoveryScore: MetricValue;
    status: "recovering" | "typical" | "strained" | "insufficient";
  };
  cardiacStrain: {
    avgAsleepBpm: MetricValue;
    timeBelowBaselinePct: MetricValue;
    strainRecoveryScore: MetricValue;
  };
}

export type MainNight = MainNightData | { status: "unavailable"; reason: "not_worn" | "not_synced" };

export interface DayData {
  /** The calendar day asked about. Sleep shown is the night that ended the morning of this date. */
  date: string;
  sleep: {
    main: MainNight;
    naps: SleepSessionData[];
  };
  restingHeartRate: MetricValue;
  hrv: MetricValue;
  steps: MetricValue;
  /** Active zone minutes computed live from the stored zone minutes (see schema for caveats). */
  /** Always unavailable / not_supported: the stored value is not trustworthy (see buildDayData). */
  activeZoneMinutes: UnavailableMetric;
  heartZoneMinutes: { light: MetricValue; moderate: MetricValue; vigorous: MetricValue; peak: MetricValue };
}

// ── Input types (plain primitives) ─────────────────────────────────────────

export interface SessionInput {
  sleepDate: string;
  startMs: number;
  endMs: number;
  startUtcOffsetSeconds: number | null;
  endUtcOffsetSeconds: number | null;
  totalSleepMs: number;
  efficiencyScore: number;
  stages: Array<{ stageType: SleepStageType; startMs: number; endMs: number; durationMs: number }>;
}

export interface DayInput extends AbsenceContext {
  date: string;
  /** Every stored session keyed to the implied night (date − 1): the main one plus any naps. */
  nightSessions: SessionInput[];
  /** assembleDashboardData's lastNight, passed only when it is that implied night. */
  lastNight: LastNightDetail | null;
  nightHeart: NightHeartSummary | null;
  cardiacStrain: CardiacStrain | null;
  /** Whether intra-night HR samples are stored for the main session (never fetched here). */
  hasNightSamples: boolean;
  /** The day's heart_rate_summaries row values; null when no row. */
  restingHeartRate: number | null;
  hrv: number | null;
  /** The day's daily_activity_summaries row; null when no row. */
  activity: {
    steps: number | null;
    light: number | null;
    moderate: number | null;
    vigorous: number | null;
    peak: number | null;
  } | null;
}

// ── Builder ────────────────────────────────────────────────────────────────

const MS_PER_MIN = 60_000;
const mins = (ms: number): number => Math.round(ms / MS_PER_MIN);

function stageSpans(s: SessionInput): StageSpan[] {
  const off = s.startUtcOffsetSeconds ?? 0;
  return [...s.stages]
    .sort((a, b) => a.startMs - b.startMs)
    .map((st) => ({
      stage: st.stageType,
      start: formatInstantWithOffset(st.startMs, off),
      end: formatInstantWithOffset(st.endMs, s.endUtcOffsetSeconds ?? off),
      minutes: mins(st.durationMs),
    }));
}

function sessionData(s: SessionInput, isMain: boolean): SleepSessionData {
  const stageMs: Record<SleepStageType, number> = { deep: 0, light: 0, rem: 0, awake: 0 };
  for (const st of s.stages) stageMs[st.stageType] += st.durationMs;
  const hasStages = s.stages.length > 0;
  const stageMetric = (t: SleepStageType): MetricValue =>
    hasStages ? measured(mins(stageMs[t]), "min") : unavailable("insufficient_data");
  const startOff = s.startUtcOffsetSeconds ?? 0;
  const endOff = s.endUtcOffsetSeconds ?? startOff;
  return {
    nightOf: s.sleepDate,
    start: formatInstantWithOffset(s.startMs, startOff),
    end: formatInstantWithOffset(s.endMs, endOff),
    isMain,
    totalSleep: measured(mins(s.totalSleepMs), "min"),
    timeInBed: measured(mins(s.endMs - s.startMs), "min"),
    efficiency: measured(s.efficiencyScore, "ratio"),
    stageMinutes: { deep: stageMetric("deep"), light: stageMetric("light"), rem: stageMetric("rem"), awake: stageMetric("awake") },
    stages: stageSpans(s),
  };
}

function mainNight(s: SessionInput, input: DayInput): MainNightData {
  const base = sessionData(s, true);
  const absence: AbsenceContext = { syncedThrough: input.syncedThrough, today: input.today };
  const ln = input.lastNight;
  const nh = input.nightHeart;
  const cs = input.cardiacStrain;
  const tooLittle = "insufficient_data" as const;

  const breakdown = ln?.holisticBreakdown;
  const hrEstimated = ln?.restlessness.source === "hr-estimated";
  const R = ln?.restlessness;

  return {
    ...base,
    status: "recorded",
    score: ln ? derived(ln.holisticScore, "score") : unavailable(tooLittle),
    scoreBreakdown: (breakdown?.components ?? []).map((c) => ({
      key: c.key,
      present: c.present,
      subScore: c.subScore !== null ? derived(c.subScore, "score") : unavailable("not_fetched"),
      weight: c.weight,
      contribution: c.contribution,
    })),
    restlessness: {
      source: R?.source ?? "none",
      restlessEvents: R && hrEstimated
        ? estimated(R.restlessCount, "count", "transient heart-rate spikes above a rolling baseline during sleep")
        : unavailable(input.hasNightSamples ? tooLittle : "not_fetched"),
      restlessMinutes: R && hrEstimated
        ? estimated(R.restlessTotalMinutes, "min", "transient heart-rate spikes above a rolling baseline during sleep")
        : unavailable(input.hasNightSamples ? tooLittle : "not_fetched"),
      awakenings: R ? derived(R.awakeningCount, "count") : unavailable(tooLittle),
      awakeMinutes: R ? derived(R.awakeningTotalMinutes, "min") : unavailable(tooLittle),
      disruptionIndex: R ? derived(R.disruptionIndex, "score") : unavailable(tooLittle),
    },
    nightHeart: {
      restingHr: nh?.restingHr != null ? measured(nh.restingHr, "bpm") : unavailable(classifyAbsence(input.date, absence)),
      hrv: nh?.hrv != null ? measured(nh.hrv, "ms") : unavailable(classifyAbsence(input.date, absence)),
      baselineRhr: nh?.baselineRhr != null ? derived(nh.baselineRhr, "bpm") : unavailable(tooLittle),
      baselineHrv: nh?.baselineHrv != null ? derived(nh.baselineHrv, "ms") : unavailable(tooLittle),
      recoveryScore: nh?.recoveryScore != null ? derived(nh.recoveryScore, "score") : unavailable(tooLittle),
      status: nh?.status ?? "insufficient",
    },
    cardiacStrain: {
      avgAsleepBpm: cs ? estimated(cs.avgAsleepBpm, "bpm", "mean of 1-minute bins inside non-awake stages") : unavailable(input.hasNightSamples ? tooLittle : "not_fetched"),
      timeBelowBaselinePct: cs ? derived(cs.timeBelowBaselinePct, "percent") : unavailable(input.hasNightSamples ? tooLittle : "not_fetched"),
      strainRecoveryScore: cs ? derived(cs.strainRecoveryScore, "score") : unavailable(input.hasNightSamples ? tooLittle : "not_fetched"),
    },
  };
}

/** The main session of a night via the engine's own rule (selectMainSessions); the rest are naps. */
function pickMain(sessions: SessionInput[]): { main: SessionInput | null; naps: SessionInput[] } {
  const main = selectMainSessions(sessions)[0] ?? null;
  return { main, naps: sessions.filter((s) => s !== main) };
}

export function buildDayData(input: DayInput): DayData {
  const ctx: AbsenceContext = { syncedThrough: input.syncedThrough, today: input.today };
  const { main, naps } = pickMain(input.nightSessions);
  const a = input.activity;

  const zone = (v: number | null | undefined): MetricValue => dayMetric(v, "min", input.date, ctx, { accumulatesDuringDay: true });

  return {
    date: input.date,
    sleep: {
      main: main ? mainNight(main, input) : { status: "unavailable", reason: classifyAbsence(input.date, ctx) },
      naps: naps.map((n) => sessionData(n, false)),
    },
    restingHeartRate: dayMetric(input.restingHeartRate, "bpm", input.date, ctx),
    hrv: dayMetric(input.hrv, "ms", input.date, ctx),
    steps: dayMetric(a?.steps, "steps", input.date, ctx, { accumulatesDuringDay: true }),
    // WITHHELD, deliberately: stored AZM is derived from Google's Karvonen zone minutes, which do not
    // match Fitbit's AZM thresholds, so the number is wrong rather than merely approximate (docs/progress.md,
    // Task 4). The stored data and calculateActiveZoneMinutes stay as they are; only the API stops exposing it.
    activeZoneMinutes: unavailable("not_supported"),
    heartZoneMinutes: { light: zone(a?.light), moderate: zone(a?.moderate), vigorous: zone(a?.vigorous), peak: zone(a?.peak) },
  };
}
