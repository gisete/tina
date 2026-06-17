"use server";

import Link from "next/link";
import { auth } from "@/auth";
import { loadPageData } from "@/app/actions/sync";
import SyncButton from "./components/sync-button";
import AutoSync from "./components/auto-sync";

function formatSleepMs(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function debtBadge(severity: string): string {
  if (severity === "high")     return "bg-red-100 text-red-700";
  if (severity === "moderate") return "bg-amber-100 text-amber-700";
  return "bg-surface-container text-on-surface-variant";
}

function heartStatusBadge(status: string): string {
  if (status === "Elevated Stress") return "bg-amber-100 text-amber-700";
  if (status === "Stable Baseline") return "bg-secondary-container text-on-surface";
  return "bg-surface-container text-on-surface-variant";
}

export default async function DashboardOverviewPage() {
  // The layout redirects unauthenticated users, but layouts and pages can
  // begin rendering concurrently in the App Router. Checking the session here
  // (auth() is request-cached by Auth.js, so this is free) prevents
  // loadPageData from firing — and logging a noisy Unauthorized error —
  // during the brief window before the layout's redirect resolves.
  const session = await auth();
  if (!session?.user?.id) return null;

  let data: Awaited<ReturnType<typeof loadPageData>> | undefined;
  try {
    data = await loadPageData();
  } catch (error) {
    console.error("Overview page error:", error);
  }

  const hasData = data?.hasData === true;

  // Sleep derived values
  const efficiency = hasData
    ? Math.round((data!.latestSummary?.efficiencyScore ?? 0) * 100)
    : null;
  const debtHours    = hasData ? (data!.analytics?.debt?.cumulativeDebtHours ?? 0) : null;
  const debtSeverity = hasData ? (data!.analytics?.debt?.severity ?? "Optimal") : null;
  const lastNight    = hasData ? (data!.lastNight ?? null) : null;

  // Heart derived values — daily array is sorted ascending by the analytics engine
  const heartDaily = hasData ? (data!.heart?.daily ?? []) : [];
  const latestHeart = heartDaily.length > 0 ? heartDaily[heartDaily.length - 1] : null;
  const latestRhr    = latestHeart?.rhr ?? null;
  const latestHrv    = latestHeart?.hrv ?? null;
  const heartStatus  = hasData ? (data!.heart?.latestStatus ?? "Insufficient Data") : "Insufficient Data";

  return (
    <div className="p-margin-mobile md:p-margin-desktop max-w-7xl mx-auto py-10 pb-24">

      {/* Page Headline */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold text-on-surface tracking-tight mb-2">Overview</h1>
          <p className="font-sans text-base text-on-surface-variant max-w-2xl">
            Your personal health intelligence hub. Select a module to explore your data.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <AutoSync shouldSync={data?.shouldAutoSync ?? false} />
          <SyncButton lastSyncedAt={data?.lastSyncedAt ?? null} />
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">

        {/* Sleep Intelligence Card */}
        <Link
          href="/dashboard/sleep"
          className="group bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] hover:border-outline transition-all min-h-[220px]"
        >
          <div className="flex items-start justify-between mb-6">
            <div>
              <span className="text-2xl">🌙</span>
              <h2 className="font-display text-xl font-bold text-on-surface tracking-tight mt-2">Sleep Intelligence</h2>
            </div>
            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full shrink-0 ${debtSeverity ? debtBadge(debtSeverity) : "bg-surface-container text-on-surface-variant"}`}>
              {debtSeverity ?? "No data"}
            </span>
          </div>

          <div>
            <div className="font-display text-5xl font-bold text-on-surface tracking-tight">
              {efficiency !== null
                ? <>{efficiency}<span className="text-2xl text-on-surface-variant font-normal ml-0.5">%</span></>
                : <span className="text-on-surface-variant">—</span>}
            </div>
            <p className="font-sans text-sm text-on-surface-variant mt-1">Sleep Efficiency</p>

            {lastNight && (
              <div className="mt-3">
                {/* Micro stacked bar — segments sum to 100% of container width */}
                <div className="flex h-1.5 rounded-full overflow-hidden">
                  {lastNight.breakdown.deepPercent  > 0 && <div className="bg-indigo-500"  style={{ width: `${lastNight.breakdown.deepPercent}%`  }} />}
                  {lastNight.breakdown.remPercent   > 0 && <div className="bg-violet-400"  style={{ width: `${lastNight.breakdown.remPercent}%`   }} />}
                  {lastNight.breakdown.lightPercent > 0 && <div className="bg-slate-300"   style={{ width: `${lastNight.breakdown.lightPercent}%` }} />}
                  {lastNight.breakdown.awakePercent > 0 && <div className="bg-amber-300"   style={{ width: `${lastNight.breakdown.awakePercent}%` }} />}
                </div>
                <p className="font-sans text-xs text-on-surface-variant mt-1.5">
                  {formatSleepMs(lastNight.totalSleepMs)} total sleep
                </p>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-outline-variant flex items-center justify-between">
              <div>
                {debtHours !== null
                  ? <><span className="font-display text-lg font-semibold text-on-surface">{debtHours} hrs</span><span className="font-sans text-xs text-on-surface-variant ml-1.5">accumulated debt</span></>
                  : <span className="font-sans text-xs text-on-surface-variant">No data yet</span>}
              </div>
              <span className="font-sans text-xs font-semibold text-on-surface-variant group-hover:text-on-surface transition-colors">
                View details →
              </span>
            </div>
          </div>
        </Link>

        {/* Heart Health Card */}
        <Link
          href="/dashboard/heart"
          className="group bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between hover:shadow-[0px_20px_40px_rgba(0,0,0,0.05)] hover:border-outline transition-all min-h-[220px]"
        >
          <div className="flex items-start justify-between mb-6">
            <div>
              <span className="text-2xl">❤️</span>
              <h2 className="font-display text-xl font-bold text-on-surface tracking-tight mt-2">Heart Health</h2>
            </div>
            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full shrink-0 ${heartStatusBadge(heartStatus)}`}>
              {heartStatus}
            </span>
          </div>

          <div>
            <div className="font-display text-5xl font-bold text-on-surface tracking-tight">
              {latestRhr !== null
                ? <>{latestRhr}<span className="text-2xl text-on-surface-variant font-normal ml-0.5">bpm</span></>
                : <span className="text-on-surface-variant">—</span>}
            </div>
            <p className="font-sans text-sm text-on-surface-variant mt-1">Resting heart rate</p>

            <div className="mt-4 pt-4 border-t border-outline-variant flex items-center justify-between">
              <div>
                {latestHrv !== null
                  ? <><span className="font-display text-lg font-semibold text-on-surface">{latestHrv}</span><span className="font-sans text-xs text-on-surface-variant ml-1.5">ms HRV</span></>
                  : <span className="font-sans text-xs text-on-surface-variant">No HRV data yet</span>}
              </div>
              <span className="font-sans text-xs font-semibold text-on-surface-variant group-hover:text-on-surface transition-colors">
                View details →
              </span>
            </div>
          </div>
        </Link>

        {/* Exercise & Endurance Card — inactive placeholder */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col justify-between opacity-50 cursor-not-allowed min-h-[220px]">
          <div className="flex items-start justify-between mb-6">
            <div>
              <span className="text-2xl">🏃‍♂️</span>
              <h2 className="font-display text-xl font-bold text-on-surface tracking-tight mt-2">Exercise & Endurance</h2>
            </div>
            <span className="px-2.5 py-1 bg-surface-container text-on-surface-variant text-xs font-semibold rounded-full shrink-0">
              Inactive
            </span>
          </div>

          <div>
            <div className="font-display text-5xl font-bold text-on-surface tracking-tight">
              0<span className="text-2xl text-on-surface-variant font-normal ml-0.5">min</span>
            </div>
            <p className="font-sans text-sm text-on-surface-variant mt-1">Active zone minutes</p>

            <div className="mt-4 pt-4 border-t border-outline-variant">
              <p className="font-sans text-xs text-on-surface-variant">
                Waiting for database migrations and normalizers.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
