"use server";

import { auth } from "@/auth";
import { syncAndFetchSleepAnalytics } from "@/app/actions/sync";
import SleepCharts from "../components/sleep-charts";
import HypnogramChart from "../components/hypnogram-chart";

function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default async function SleepPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  let data: Awaited<ReturnType<typeof syncAndFetchSleepAnalytics>> | undefined;
  try {
    data = await syncAndFetchSleepAnalytics(14);
  } catch (error) {
    console.error("Sleep page sync error:", error);
  }

  return (
    <div className="p-margin-mobile md:p-margin-desktop max-w-7xl mx-auto space-y-6 py-10 pb-24">

      {/* Page Headline Block */}
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold text-black mb-2 tracking-tight">Sleep Intelligence</h1>
        <p className="text-base text-on-surface-variant max-w-2xl">
          Analyze your sleep architecture, efficiency, and debt to optimize recovery and daily performance.
        </p>
      </div>

      {!data || !data.hasData ? (
        <div className="rounded-[1.5rem] border border-dashed border-outline-variant bg-white p-12 text-center">
          <h3 className="font-display text-sm font-semibold text-on-surface">No sleep data found</h3>
          <p className="mt-1 text-sm text-on-surface-variant">
            Trigger your synchronization loop to pull records from your Fitbit profile.
          </p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* ── Sleep Timeline card ─────────────────────────────────────────── */}
          {data.lastNight && (
            <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">

              {/* Card header — title + elapsed-time summary */}
              <div className="mb-6">
                <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">
                  Sleep Timeline
                </h2>
                <p className="font-sans text-sm text-on-surface-variant mt-1">
                  {formatSessionTime(data.lastNight.startTime)}
                  <span className="mx-2 text-outline-variant">–</span>
                  {formatSessionTime(data.lastNight.endTime)}
                </p>
              </div>

              {/* Chart — bare mode: no inner card wrapper or duplicate header */}
              <HypnogramChart
                timeline={data.lastNight.timeline}
                sessionStart={data.lastNight.startTime}
                sessionEnd={data.lastNight.endTime}
                bare
              />

            </div>
          )}

          {/* ── Highlights Cards Grid ───────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">

            {/* Efficiency Card */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium text-on-surface-variant">Sleep Efficiency</span>
                <span className="px-2 py-0.5 bg-primary-container text-black font-semibold text-xs rounded-full">Target &gt;85%</span>
              </div>
              <div>
                <div className="font-display text-4xl font-bold text-black tracking-tight">
                  {Math.round((data.latestSummary?.efficiencyScore || 0) * 100)}<span className="text-xl text-on-surface-variant font-normal ml-0.5">%</span>
                </div>
                <div className="text-sm text-on-surface-variant mt-1">Optimal restorative window alignment</div>
              </div>
            </div>

            {/* Circadian Rhythm Card */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium text-on-surface-variant">Circadian Rhythm</span>
                <span className="px-2 py-0.5 bg-surface-container text-on-surface-variant font-semibold text-xs rounded-full">
                  {data.analytics?.variance?.status || "Stable"}
                </span>
              </div>
              <div>
                <div className="font-display text-4xl font-bold text-black tracking-tight">
                  ±{data.analytics?.variance?.standardDeviationMinutes || 0}<span className="text-xl text-on-surface-variant font-normal ml-0.5">m</span>
                </div>
                <div className="text-sm text-on-surface-variant mt-1">Bedtime variance over historical array</div>
              </div>
            </div>

            {/* Sleep Debt Card */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium text-on-surface-variant">Sleep Debt</span>
                <span className="px-2 py-0.5 bg-secondary-container text-black font-semibold text-xs rounded-full">
                  {data.analytics?.debt?.severity || "Optimal"}
                </span>
              </div>
              <div>
                <div className="font-display text-4xl font-bold text-black tracking-tight">
                  {data.analytics?.debt?.cumulativeDebtHours || 0}<span className="text-xl text-on-surface-variant font-normal ml-0.5">hrs</span>
                </div>
                <div className="text-sm text-on-surface-variant mt-1">Requires attention over upcoming cycles</div>
              </div>
            </div>

          </div>

          {/* Architecture Breakdown */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding">
            <div className="mb-6">
              <h2 className="font-display text-xl font-bold text-black tracking-tight">Architecture Breakdown</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              {/* Deep Sleep */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <span className="text-sm font-semibold text-on-surface">Deep Sleep</span>
                    <p className="text-xs text-on-surface-variant mt-0.5">Physical recovery & muscular restoration</p>
                  </div>
                  <div className="text-right">
                    <span className="font-display text-lg font-bold text-black">
                      {data.analytics?.architecture?.deepPercentage || 0}%
                    </span>
                    <span className="text-xs text-on-surface-variant ml-1">/ Target 15-20%</span>
                  </div>
                </div>
                <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className="h-full bg-black rounded-full transition-all duration-500"
                    style={{ width: `${data.analytics?.architecture?.deepPercentage || 0}%` }}
                  />
                </div>
              </div>

              {/* REM Sleep */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <span className="text-sm font-semibold text-on-surface">REM Sleep</span>
                    <p className="text-xs text-on-surface-variant mt-0.5">Cognitive filing & mental clarity consolidation</p>
                  </div>
                  <div className="text-right">
                    <span className="font-display text-lg font-bold text-black">
                      {data.analytics?.architecture?.remPercentage || 0}%
                    </span>
                    <span className="text-xs text-on-surface-variant ml-1">/ Target 20-25%</span>
                  </div>
                </div>
                <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-container rounded-full transition-all duration-500 border border-outline-variant"
                    style={{ width: `${data.analytics?.architecture?.remPercentage || 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Charts */}
          <SleepCharts data={data.chartTimeline || []} />

        </div>
      )}
    </div>
  );
}
