// Pure assembly of the dashboard analytics payload from DB rows.
// No database, auth, or framework imports — feed it row fixtures in tests
// and assert on the returned payload.

import {
  calculateSleepArchitecture,
  calculateCircadianVariance,
  calculateSleepDebt,
  calculateSleepScoreBreakdown,
  calculateHolisticSleepScore,
  calculateDeepSleepContinuity,
  calculateRestlessness,
  calculateNightHeartSummary,
  getLastNightDetail,
  detectHrRestlessness,
  computeDisruptionIndex,
  calculateCardiacStrain,
  selectMainSessions,
  type AnalyticSession,
  type CardiacStrain,
  type NightHeartSummary,
  type SleepStageType,
} from "@/lib/analytics/sleep";
import { calculateHeartAnalytics, type HeartRateSummaryRow } from "@/lib/analytics/heart";
import { addDays } from "@/lib/dates";

/** Row shape returned by the sleep_sessions query with `with: { stages: true }`. */
export interface SleepSessionRow {
  sleepDate: string;
  startTime: Date;
  endTime: Date;
  totalSleepMs: number;
  efficiencyScore: number;
  stages: Array<{
    stageType: SleepStageType;
    startTime: Date;
    endTime: Date;
    durationMs: number;
  }>;
}

export type DashboardData = ReturnType<typeof assembleDashboardData>;

/**
 * Derives every dashboard metric from historical rows. Sessions are expected
 * sorted descending by sleepDate (index 0 = most recent night in range).
 * `nightHrSamples` are intra-night heart rate readings covering the displayed
 * (most recent in range) session, sorted ascending.
 *
 * `currentStateSessions` — when the caller is anchored to a past `targetDate`,
 * pass the truly-latest (unscoped) sessions here so `currentState.debt` and
 * `currentState.variance` always reflect now, not the selected night's horizon.
 * Omit when already querying the latest data (no `targetDate`).
 *
 * `chartSessionRows` — today-anchored sessions with stages used exclusively for
 * `chartTimeline`. Supply when `targetDate` is in the past so the Sleep Score
 * Trend stays anchored to today as the user navigates nights. Omit when already
 * on today's view (`sessions` is already today-anchored).
 */
export function assembleDashboardData(
  sessions: SleepSessionRow[],
  heartRows: HeartRateSummaryRow[],
  nightHrSamples: Array<{ timestamp: Date; bpm: number }> = [],
  sleepDebtTargetHours: number = 8,
  currentStateSessions?: AnalyticSession[],
  chartSessionRows?: SleepSessionRow[],
) {
  if (sessions.length === 0) {
    return { hasData: false as const, message: "No sleep records processed yet." };
  }

  const analyticSessions = sessions.map((s) => ({
    sleepDate: s.sleepDate,
    startTime: s.startTime,
    endTime: s.endTime,
    totalSleepMs: s.totalSleepMs,
    efficiencyScore: s.efficiencyScore,
    // Preserve startTime/endTime per stage so getLastNightDetail can build
    // the chronological timeline without a second DB round-trip.
    stages: s.stages.map((st) => ({
      stageType: st.stageType,
      startTime: st.startTime,
      endTime: st.endTime,
      durationMs: st.durationMs,
    })),
  }));

  // One session per date — naps are excluded from all analytics so a 1h nap
  // on the same date as the main night doesn't inflate debt or distort variance.
  const mainSessions = selectMainSessions(analyticSessions);

  const architecture = calculateSleepArchitecture(mainSessions[0].stages ?? []);
  const variance = calculateCircadianVariance(mainSessions);
  const debt = calculateSleepDebt(mainSessions, sleepDebtTargetHours);

  // Current-state metrics are always anchored to the present moment. When a
  // past targetDate is in use, the caller supplies unscoped sessions so debt
  // and variance don't shift as the user navigates nights.
  const currentMain = currentStateSessions
    ? selectMainSessions(currentStateSessions)
    : mainSessions;
  const currentDebt = currentStateSessions
    ? calculateSleepDebt(currentMain, sleepDebtTargetHours)
    : debt;
  const currentVariance = currentStateSessions
    ? calculateCircadianVariance(currentMain)
    : variance;
  const lastNight = getLastNightDetail(mainSessions);

  // When a past targetDate is in use, chartSessionRows holds today-anchored
  // sessions so the trend stays "as of today" regardless of which night is selected.
  const chartSource = chartSessionRows
    ? selectMainSessions(
        chartSessionRows.map((s) => ({
          sleepDate: s.sleepDate,
          startTime: s.startTime,
          endTime: s.endTime,
          totalSleepMs: s.totalSleepMs,
          efficiencyScore: s.efficiencyScore,
          stages: s.stages.map((st) => ({
            stageType: st.stageType,
            startTime: st.startTime,
            endTime: st.endTime,
            durationMs: st.durationMs,
          })),
        }))
      )
    : mainSessions;

  const chartTimeline = [...chartSource]
    .sort((a, b) => a.sleepDate.localeCompare(b.sleepDate))
    .map((s) => {
      const timeInBedMs = s.endTime.getTime() - s.startTime.getTime();
      // Convert stage Date objects to ISO strings for the pure analytics engines.
      const stageIntervals = (s.stages ?? []).map((st) => ({
        stageType: st.stageType,
        startTime: st.startTime.toISOString(),
        endTime: st.endTime.toISOString(),
        durationMs: st.durationMs,
      }));
      const deepContinuity = calculateDeepSleepContinuity(stageIntervals);
      const restlessness = calculateRestlessness(stageIntervals);
      const sleepScore = calculateHolisticSleepScore(
        s.totalSleepMs,
        timeInBedMs,
        deepContinuity.continuityScore,
        restlessness.disruptionIndex,
        null,
      );
      return {
        date: s.sleepDate,
        sleepScore,
      };
    });

  const heart = calculateHeartAnalytics(heartRows);

  // ── Per-night enrichment (order matters: restlessness → cardiac → score) ──

  let nightHeart: NightHeartSummary | null = null;
  let cardiacStrain: CardiacStrain | null = null;

  if (lastNight) {
    // Convert once; reused for both restlessness and cardiac strain.
    const hrSeries = nightHrSamples.map((s) => ({
      timestamp: s.timestamp.getTime(),
      bpm: s.bpm,
    }));

    // 1. HR-restlessness: override the stage-only restless events with events
    //    detected from transient HR spikes. Awakenings stay unchanged.
    if (hrSeries.length > 0) {
      const hrEvents = detectHrRestlessness(hrSeries, lastNight.timeline);
      const restlessMs = hrEvents.reduce((sum, e) => sum + e.durationMs, 0);
      const restlessMinutes = restlessMs / 60_000;

      lastNight.restlessness = {
        restlessEvents: hrEvents,
        restlessCount: hrEvents.length,
        restlessTotalMinutes: Math.round(restlessMinutes),
        awakeningCount: lastNight.restlessness.awakeningCount,
        awakeningTotalMinutes: lastNight.restlessness.awakeningTotalMinutes,
        disruptionIndex: computeDisruptionIndex(
          hrEvents.length,
          restlessMinutes,
          lastNight.restlessness.awakeningCount,
          lastNight.restlessness.awakeningTotalMinutes
        ),
        source: "hr-estimated",
      };
    }

    // 2. Night heart summary (daily RHR/HRV) and intra-night cardiac strain.
    //    Baseline: prefer the 7-day rolling RHR; fall back to the window avg.
    // Wake date = the morning after the night-of date. Derived from sleepDate
    // (already offset-correct) rather than slicing the UTC end_time, which
    // would miskey cardiac lookups on midnight-crossing sessions.
    const wakeDate = addDays(lastNight.sleepDate, 1);
    nightHeart = calculateNightHeartSummary(heart.daily, wakeDate);
    const baselineRhr =
      nightHeart.baselineRhr ?? heart.overallBaseline.avgRhr ?? null;

    cardiacStrain = calculateCardiacStrain(hrSeries, lastNight.timeline, baselineRhr);

    // 3. Holistic score: all five components. Cardiac source priority:
    //    intra-night strain recovery > daily RHR/HRV summary > absent.
    const cardiacScore =
      cardiacStrain?.strainRecoveryScore ?? nightHeart.recoveryScore ?? null;
    const timeInBedMs =
      new Date(lastNight.endTime).getTime() - new Date(lastNight.startTime).getTime();

    const holisticBreakdown = calculateSleepScoreBreakdown(
      lastNight.totalSleepMs,
      timeInBedMs,
      lastNight.continuity.continuityScore,
      lastNight.restlessness.disruptionIndex,
      cardiacScore
    );
    lastNight.holisticScore = holisticBreakdown.score;
    lastNight.holisticBreakdown = holisticBreakdown;
  }

  return {
    hasData: true as const,
    latestSummary: mainSessions[0],
    chartTimeline,
    analytics: { architecture, variance, debt },
    // Always reflects the present moment regardless of the selected night.
    currentState: { debt: currentDebt, variance: currentVariance },
    lastNight,
    nightHeart,
    cardiacStrain,
    // Plain primitives (Unix ms) so the series crosses the server boundary.
    nightHrSeries: nightHrSamples.map((s) => ({ timestamp: s.timestamp.getTime(), bpm: s.bpm })),
    heart,
  };
}
