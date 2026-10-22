"use server";

import Link from "next/link";
import { auth } from "@/auth";
import { loadPageData } from "@/app/actions/sync";
import { readNightFeeling } from "@/lib/sync/read";
import SyncButton from "../components/sync-button";
import SleepCharts from "../components/sleep-charts";
import HypnogramChart from "../components/hypnogram-chart";
import SleepScoreCard from "../components/sleep-score-card";
import DateNavigator from "../components/date-navigator";
import ContinuityExplainer from "../components/continuity-explainer";
import NightFeelingInput from "../components/night-feeling-input";
import NightSummaryHero from "../components/night-summary-hero";
import { localToday } from "@/lib/dates";
import { formatClockTime } from "@/lib/format";

export default async function SleepPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  const params = await searchParams;
  const targetDate = params.date || localToday();

  let data: Awaited<ReturnType<typeof loadPageData>> | undefined;
  try {
    data = await loadPageData(targetDate);
  } catch (error) {
    console.error("Sleep page error:", error);
  }

  const nightOf = data?.hasData === true && data.lastNight ? data.lastNight.sleepDate : null;
  const initialTagIds = nightOf ? await readNightFeeling(userId, nightOf) : [];

  return (
    <div className="p-margin-mobile md:p-margin-desktop max-w-7xl mx-auto space-y-8 py-10 pb-24">

      {/* Page headline */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-display text-4xl font-bold text-black tracking-tight">Sleep Intelligence</h1>
        <div className="flex items-center gap-2.5">
          <SyncButton lastSyncedAt={data?.lastSyncedAt ?? null} />
        </div>
      </div>

      {!data || !data.hasData ? (
        <div className="rounded-[1.5rem] border border-dashed border-outline-variant bg-white p-12 text-center">
          <h3 className="font-display text-sm font-semibold text-on-surface">No sleep data found</h3>
          <p className="mt-1 text-sm text-on-surface-variant">
            Trigger your synchronization loop to pull records from your Fitbit profile.
          </p>
        </div>
      ) : (
        <div className="space-y-10">

          {/* ════ SELECTED NIGHT ════════════════════════════════════════════ */}
          <div className="space-y-5">

            {/* Date navigator row */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">Selected night</h2>
              <DateNavigator />
            </div>

            {/* ① Night summary hero — no card chrome */}
            {data.lastNight && (
              <NightSummaryHero
                totalSleepMs={data.lastNight.totalSleepMs}
                holisticScore={data.lastNight.holisticScore}
                efficiencyScore={data.lastNight.efficiencyScore}
                sleepDate={data.lastNight.sleepDate}
                startTime={data.lastNight.startTime}
                endTime={data.lastNight.endTime}
              />
            )}

            {/* ② How I felt */}
            {data.lastNight && nightOf && (
              <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">
                <h2 className="font-display text-xl font-bold text-on-surface tracking-tight mb-4">How I felt</h2>
                <NightFeelingInput
                  key={nightOf}
                  nightOf={nightOf}
                  initialTagIds={initialTagIds}
                  isCurrentNight={targetDate === localToday()}
                />
              </div>
            )}

            {/* ③ Sleep Timeline */}
            {data.lastNight && (
              <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">
                <div className="mb-6">
                  <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">Sleep Timeline</h2>
                  <p className="font-sans text-sm text-on-surface-variant mt-1">
                    {formatClockTime(data.lastNight.startTime)}
                    <span className="mx-2 text-outline-variant">–</span>
                    {formatClockTime(data.lastNight.endTime)}
                  </p>
                </div>
                <HypnogramChart
                  timeline={data.lastNight.timeline}
                  sessionStart={data.lastNight.startTime}
                  sessionEnd={data.lastNight.endTime}
                  restlessEvents={data.lastNight.restlessness.restlessEvents}
                  restlessnessSource={data.lastNight.restlessness.source}
                  bare
                />
              </div>
            )}

            {/* ④ Night Heart Rate */}
            <Link
              href={`/dashboard/sleep/heart-rate?date=${targetDate}`}
              className="group bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] hover:border-outline transition-all"
            >
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium text-on-surface-variant">Night Heart Rate</span>
                <span className={`px-2 py-0.5 font-semibold text-xs rounded-full ${
                  data.nightHeart?.status === "recovering" ? "bg-emerald-100 text-emerald-800" :
                  data.nightHeart?.status === "strained"   ? "bg-amber-100 text-amber-800" :
                  "bg-surface-container text-on-surface-variant"
                }`}>
                  {data.nightHeart?.status === "insufficient" || !data.nightHeart ? "No data" : data.nightHeart.status}
                </span>
              </div>
              <div>
                <div className="font-display text-4xl font-bold text-heart-accent tracking-tight">
                  {data.nightHeart?.restingHr != null
                    ? <>{data.nightHeart.restingHr}<span className="text-xl text-on-surface-variant font-normal ml-0.5">bpm</span></>
                    : <span className="text-on-surface-variant">—</span>}
                </div>
                <div className="text-sm text-on-surface-variant mt-1">
                  {data.nightHeart?.hrv != null
                    ? `${data.nightHeart.hrv} ms HRV${data.nightHeart.baselineRhr != null ? ` · baseline ${data.nightHeart.baselineRhr} bpm` : ""}`
                    : "Awaiting overnight readings"}
                </div>
                <div className="mt-3 pt-3 border-t border-outline-variant/50 flex justify-end">
                  <span className="text-xs font-semibold text-on-surface-variant group-hover:text-on-surface transition-colors">
                    See more →
                  </span>
                </div>
              </div>
            </Link>

            {/* ⑤ Bottom breakdown zone — score detail (compact) + architecture, side by side */}
            {data.lastNight && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter items-start">

                {/* Sleep Score breakdown (compact: score de-emphasised, expander shows components) */}
                <SleepScoreCard
                  score={data.lastNight.holisticScore || 0}
                  breakdown={data.lastNight.holisticBreakdown}
                  compact
                />

                {/* Architecture Breakdown */}
                <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding">
                  <h2 className="font-display text-xl font-bold text-black tracking-tight mb-6">Architecture Breakdown</h2>

                  <div className="space-y-6">

                    {/* Deep Sleep */}
                    <div>
                      <div className="flex justify-between items-end mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-on-surface">Deep Sleep</span>
                            {data.lastNight.continuity && (
                              <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm ${
                                data.lastNight.continuity.status === "consolidated" ? "bg-indigo-100 text-indigo-800" :
                                data.lastNight.continuity.status === "fragmented"   ? "bg-amber-100 text-amber-800" :
                                "bg-surface-container text-on-surface-variant"
                              }`}>
                                {data.lastNight.continuity.status}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-on-surface-variant mt-0.5">Physical recovery &amp; muscular restoration</p>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <span className="font-display text-lg font-bold text-black">{data.analytics?.architecture?.deepPercentage || 0}%</span>
                          <span className="text-xs text-on-surface-variant ml-1">/ 15-20%</span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                        <div className="h-full bg-black rounded-full transition-all duration-500" style={{ width: `${data.analytics?.architecture?.deepPercentage || 0}%` }} />
                      </div>
                      {data.lastNight.continuity && <ContinuityExplainer stage="deep" data={data.lastNight.continuity} />}
                    </div>

                    {/* REM Sleep */}
                    <div>
                      <div className="flex justify-between items-end mb-2">
                        <div>
                          <span className="text-sm font-semibold text-on-surface">REM Sleep</span>
                          <p className="text-xs text-on-surface-variant mt-0.5">Cognitive filing &amp; mental clarity consolidation</p>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <span className="font-display text-lg font-bold text-black">{data.analytics?.architecture?.remPercentage || 0}%</span>
                          <span className="text-xs text-on-surface-variant ml-1">/ 20-25%</span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                        <div className="h-full bg-primary-container rounded-full transition-all duration-500 border border-outline-variant" style={{ width: `${data.analytics?.architecture?.remPercentage || 0}%` }} />
                      </div>
                      {data.lastNight.remContinuity && <ContinuityExplainer stage="rem" data={data.lastNight.remContinuity} />}
                    </div>

                    {/* Light Sleep */}
                    <div>
                      <div className="flex justify-between items-end mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-on-surface">Light Sleep</span>
                            {data.lastNight.lightStability && (
                              <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm ${
                                data.lastNight.lightStability.status === "optimal"    ? "bg-emerald-100 text-emerald-800" :
                                data.lastNight.lightStability.status === "disruptive" ? "bg-red-100 text-red-800" :
                                "bg-amber-100 text-amber-800"
                              }`}>
                                {data.lastNight.lightStability.status}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-on-surface-variant mt-0.5">Transitionary bridge &amp; basal processing</p>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <span className="font-display text-lg font-bold text-black">{data.analytics?.architecture?.lightPercentage || 0}%</span>
                          <span className="text-xs text-on-surface-variant ml-1">/ 50-60%</span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-400 rounded-full transition-all duration-500 border border-outline-variant" style={{ width: `${data.analytics?.architecture?.lightPercentage || 0}%` }} />
                      </div>
                      {data.lastNight.lightStability && <ContinuityExplainer stage="light" data={data.lastNight.lightStability} />}
                    </div>

                  </div>
                </div>

              </div>
            )}

          </div>{/* end Selected Night */}

          {/* ════ CURRENT STATUS · as of today ══════════════════════════════ */}
          <div className="space-y-4">

            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">Current status</h2>
              <span className="text-sm text-on-surface-variant">· as of today</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">

              {/* Sleep Debt — link to detail page */}
              <Link
                href="/dashboard/sleep/debt"
                className="group bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] hover:border-outline transition-all"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className="text-sm font-medium text-on-surface-variant">Sleep Debt</span>
                  <span className={`px-2 py-0.5 font-semibold text-xs rounded-full ${
                    data.currentState.debt.severity === "high"     ? "bg-red-100 text-red-700" :
                    data.currentState.debt.severity === "moderate" ? "bg-amber-100 text-amber-700" :
                    "bg-surface-container text-on-surface-variant"
                  }`}>
                    {data.currentState.debt.severity}
                  </span>
                </div>
                <div>
                  <div className="font-display text-4xl font-bold text-black tracking-tight">
                    {data.currentState.debt.cumulativeDebtHours}<span className="text-xl text-on-surface-variant font-normal ml-0.5">hrs</span>
                  </div>
                  <div className="text-sm text-on-surface-variant mt-1">Decay-weighted deficit over the last 14 nights</div>
                  <div className="mt-3 pt-3 border-t border-outline-variant/50 flex justify-end">
                    <span className="text-xs font-semibold text-on-surface-variant group-hover:text-on-surface transition-colors">
                      View history →
                    </span>
                  </div>
                </div>
              </Link>

              {/* Circadian Rhythm */}
              <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-sm font-medium text-on-surface-variant">Circadian Rhythm</span>
                  <span className="px-2 py-0.5 bg-surface-container text-on-surface-variant font-semibold text-xs rounded-full">
                    {data.currentState.variance?.status || "Stable"}
                  </span>
                </div>
                <div>
                  <div className="font-display text-4xl font-bold text-black tracking-tight">
                    ±{data.currentState.variance?.standardDeviationMinutes || 0}<span className="text-xl text-on-surface-variant font-normal ml-0.5">m</span>
                  </div>
                  <div className="text-sm text-on-surface-variant mt-1">Bedtime variance over the last 14 nights</div>
                </div>
              </div>

            </div>

          </div>{/* end Current Status */}

          {/* ════ SLEEP SCORE TREND ══════════════════════════════════════════ */}
          <SleepCharts data={(data.chartTimeline || []).map(({ date, sleepScore }) => ({ date, sleepScore }))} />

        </div>
      )}
    </div>
  );
}
