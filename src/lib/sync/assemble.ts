// Pure assembly of the dashboard analytics payload from DB rows.
// No database, auth, or framework imports — feed it row fixtures in tests
// and assert on the returned payload.

import {
  calculateSleepArchitecture,
  calculateCircadianVariance,
  calculateSleepDebt,
  calculateHolisticSleepScore,
  calculateNightHeartSummary,
  getLastNightDetail,
  type NightHeartSummary,
  type SleepStageType,
} from "@/lib/analytics/sleep";
import { calculateHeartAnalytics, type HeartRateSummaryRow } from "@/lib/analytics/heart";

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
 */
export function assembleDashboardData(
  sessions: SleepSessionRow[],
  heartRows: HeartRateSummaryRow[],
  nightHrSamples: Array<{ timestamp: Date; bpm: number }> = [],
  sleepDebtTargetHours: number = 8
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

  const latestSessionWithStages = analyticSessions[0];
  const architecture = calculateSleepArchitecture(latestSessionWithStages.stages ?? []);
  const variance = calculateCircadianVariance(analyticSessions);
  const debt = calculateSleepDebt(analyticSessions, sleepDebtTargetHours);
  const lastNight = getLastNightDetail(analyticSessions);

  const chartTimeline = [...analyticSessions]
    .sort((a, b) => a.sleepDate.localeCompare(b.sleepDate))
    .map((s) => {
      const debtItem = debt.timeline.find((t) => t.date === s.sleepDate);
      return {
        date: s.sleepDate,
        efficiency: Math.round(s.efficiencyScore * 100),
        runningDebtHours: debtItem?.runningDebtHours ?? 0,
      };
    });

  const heart = calculateHeartAnalytics(heartRows);

  // Overnight cardiac summary for the selected night: resting HR / HRV are
  // measured during sleep, so the reading dated the wake-up morning (the
  // civil date of the session's endTime) describes that night. When it
  // yields a recovery score, the holistic score is recomputed with the
  // cardiac component included (40/30/20/10 weighting instead of 45/35/20).
  let nightHeart: NightHeartSummary | null = null;
  if (lastNight) {
    const wakeDate = lastNight.endTime.split("T")[0];
    nightHeart = calculateNightHeartSummary(heart.daily, wakeDate);

    if (nightHeart.recoveryScore !== null) {
      const timeInBedMs =
        new Date(lastNight.endTime).getTime() - new Date(lastNight.startTime).getTime();
      lastNight.holisticScore = calculateHolisticSleepScore(
        lastNight.totalSleepMs,
        timeInBedMs,
        lastNight.continuity.continuityScore,
        nightHeart.recoveryScore
      );
    }
  }

  return {
    hasData: true as const,
    latestSummary: latestSessionWithStages,
    chartTimeline,
    analytics: { architecture, variance, debt },
    lastNight,
    nightHeart,
    // Plain primitives (Unix ms) so the series crosses the server boundary.
    nightHrSeries: nightHrSamples.map((s) => ({ timestamp: s.timestamp.getTime(), bpm: s.bpm })),
    heart,
  };
}
