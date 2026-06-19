"use server";

import { auth } from "@/auth";
import { loadPageData } from "@/app/actions/sync";
import { readActivitySummaries } from "@/lib/sync/read";
import SyncButton from "../components/sync-button";
import AutoSync from "../components/auto-sync";
import HeartCharts from "../components/heart-charts";
import DateNavigator from "../components/date-navigator";
import AzmTrendCard from "../components/azm-trend-card";
import { localToday, addDays } from "@/lib/dates";

function statusBadge(status: string): string {
  if (status === "Elevated Stress") return "bg-amber-100 text-amber-700";
  if (status === "Stable Baseline") return "bg-secondary-container text-on-surface";
  return "bg-surface-container text-on-surface-variant";
}

export default async function HeartPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  const params = await searchParams;
  const targetDate = params.date || localToday();

  // AZM data is always anchored to today — independent of ?date=.
  const today          = localToday();
  const activityStart  = addDays(today, -89);

  const [pageDataResult, activityResult] = await Promise.allSettled([
    loadPageData(targetDate),
    readActivitySummaries(userId, activityStart, today),
  ]);

  let data: Awaited<ReturnType<typeof loadPageData>> | undefined;
  if (pageDataResult.status === "fulfilled") data = pageDataResult.value;
  else console.error("Heart page error:", pageDataResult.reason);

  const activityRows = activityResult.status === "fulfilled" ? activityResult.value : [];

  const hasData    = data?.hasData === true;
  const heart      = hasData ? data!.heart : null;

  // Daily array is sorted ascending by the analytics engine — last item = today
  const daily      = heart?.daily ?? [];
  const latestDay  = daily.length > 0 ? daily[daily.length - 1] : null;

  const latestRhr    = latestDay?.rhr ?? null;
  const latestHrv    = latestDay?.hrv ?? null;
  const baselineRhr  = latestDay?.baselineRhr ?? null;
  const baselineHrv  = latestDay?.baselineHrv ?? null;
  const latestStatus = heart?.latestStatus ?? "Insufficient Data";
  const avgRhr       = heart?.overallBaseline?.avgRhr ?? null;
  const avgHrv       = heart?.overallBaseline?.avgHrv ?? null;

  const hasHeartData = daily.length > 0;

  return (
    <div className="p-margin-mobile md:p-margin-desktop max-w-7xl mx-auto space-y-6 py-10 pb-24">

      {/* Page Headline */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold text-black mb-2 tracking-tight">Heart Health</h1>
          <p className="text-base text-on-surface-variant max-w-2xl">
            Monitor resting heart rate and HRV trends to gauge cardiovascular fitness and daily autonomic recovery load.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AutoSync shouldSync={data?.shouldAutoSync ?? false} />
          <SyncButton lastSyncedAt={data?.lastSyncedAt ?? null} />
          <DateNavigator />
        </div>
      </div>

      {/* AZM trend — always rendered; anchored to today regardless of ?date= */}
      <AzmTrendCard rows={activityRows} />

      {!hasHeartData ? (
        <div className="rounded-[1.5rem] border border-dashed border-outline-variant bg-white p-12 text-center">
          <h3 className="font-display text-sm font-semibold text-on-surface">No heart data found</h3>
          <p className="mt-1 text-sm text-on-surface-variant">
            Trigger your synchronization loop to pull records from your Fitbit profile.
          </p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">

            {/* Resting HR */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium text-on-surface-variant">Resting Heart Rate</span>
                <span className="px-2 py-0.5 bg-primary-container text-black font-semibold text-xs rounded-full">Target &lt;60 bpm</span>
              </div>
              <div>
                <div className="font-display text-4xl font-bold text-black tracking-tight">
                  {latestRhr !== null
                    ? <>{latestRhr}<span className="text-xl text-on-surface-variant font-normal ml-0.5">bpm</span></>
                    : <span className="text-on-surface-variant">—</span>}
                </div>
                <div className="text-sm text-on-surface-variant mt-1">
                  {avgRhr !== null ? `${avgRhr} bpm historical average` : "Latest recorded reading"}
                </div>
              </div>
            </div>

            {/* HRV */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium text-on-surface-variant">HRV (RMSSD)</span>
                <span className="px-2 py-0.5 bg-secondary-container text-black font-semibold text-xs rounded-full">Target &gt;50 ms</span>
              </div>
              <div>
                <div className="font-display text-4xl font-bold text-black tracking-tight">
                  {latestHrv !== null
                    ? <>{latestHrv}<span className="text-xl text-on-surface-variant font-normal ml-0.5">ms</span></>
                    : <span className="text-on-surface-variant">—</span>}
                </div>
                <div className="text-sm text-on-surface-variant mt-1">
                  {avgHrv !== null ? `${avgHrv} ms historical average` : "Overnight RMSSD measurement"}
                </div>
              </div>
            </div>

            {/* Recovery Status */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <span className="text-sm font-medium text-on-surface-variant">Recovery Status</span>
                <span className={`px-2 py-0.5 font-semibold text-xs rounded-full ${statusBadge(latestStatus)}`}>
                  {latestStatus}
                </span>
              </div>
              <div>
                <div className="font-display text-4xl font-bold text-black tracking-tight">
                  {baselineRhr !== null
                    ? <>{baselineRhr}<span className="text-xl text-on-surface-variant font-normal ml-0.5">bpm</span></>
                    : <span className="text-on-surface-variant">—</span>}
                </div>
                <div className="text-sm text-on-surface-variant mt-1">
                  {baselineRhr !== null
                    ? `7-day rolling baseline${baselineHrv !== null ? ` · ${baselineHrv} ms HRV` : ""}`
                    : "Building baseline — more data needed"}
                </div>
              </div>
            </div>

          </div>

          {/* Historical Timeline Charts */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding">
            <div className="mb-6">
              <h2 className="font-display text-xl font-bold text-black tracking-tight">Historical Trends</h2>
              <p className="text-sm text-on-surface-variant mt-1">
                Solid lines show daily readings. Dashed lines show the rolling 7-day baseline used for anomaly detection.
              </p>
            </div>
            <HeartCharts data={daily} />
          </div>

        </div>
      )}
    </div>
  );
}
