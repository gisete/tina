"use server";

import { PageShell, PageTitle } from "./components/page-shell";
import Link from "next/link";
import { auth } from "@/auth";
import { loadPageData } from "@/app/actions/sync";
import SyncButton from "./components/sync-button";
import { formatDebtBasis, formatEfficiency } from "@/lib/format";
import LastRecordedNightTag from "./components/last-recorded-night-tag";
import { EmptyStateCard, StatCard, StatValue } from "./components/stat-card";

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
  return "bg-white text-sleep-ink";
}

function heartStatusBadge(status: string): string {
  if (status === "Elevated Stress") return "bg-amber-100 text-amber-700";
  return "bg-white text-heart-ink";
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
  const rawEfficiency = hasData ? data!.latestSummary?.efficiencyScore : undefined;
  const efficiency = formatEfficiency(
    rawEfficiency === null || rawEfficiency === undefined ? null : rawEfficiency * 100,
  );
  const debtHours    = hasData ? (data!.analytics?.debt?.cumulativeDebtHours ?? 0) : null;
  const debtBasis    = hasData && data!.analytics?.debt ? formatDebtBasis(data!.analytics.debt.nightsUsed, data!.analytics.debt.windowSpanDays) : null;
  const debtSeverity = hasData ? (data!.analytics?.debt?.severity ?? "Optimal") : null;
  const lastNight    = hasData ? (data!.lastNight ?? null) : null;
  // Overview is as-of-today: loadPageData() resolves today's implied night.
  // When that night is missing, lastNight is an older night and must say so.
  const selected     = hasData ? data!.selectedNight : null;
  const staleNight   = selected?.status === "missing";

  // Heart derived values — daily array is sorted ascending by the analytics engine
  const heartDaily = hasData ? (data!.heart?.daily ?? []) : [];
  const latestHeart = heartDaily.length > 0 ? heartDaily[heartDaily.length - 1] : null;
  const latestRhr    = latestHeart?.rhr ?? null;
  const latestHrv    = latestHeart?.hrv ?? null;
  const heartStatus  = hasData ? (data!.heart?.latestStatus ?? "Insufficient Data") : "Insufficient Data";

  return (
    <PageShell>

      {/* Page Headline */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-2">Overview</PageTitle>
          <p className="font-sans text-base text-on-surface-variant max-w-2xl">
            Your personal health intelligence hub. Select a module to explore your data.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <SyncButton lastSyncedAt={data?.lastSyncedAt ?? null} />
        </div>
      </div>

      {/* Module cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">

        {/* Sleep Intelligence Card. The "high" debt badge stays red (warning). */}
        <Link href="/dashboard/sleep" className="group block">
          <StatCard
            tone="sleep"
            eyebrow="Sleep intelligence"
            size="feature"
            className="h-full"
            topRight={
              <span className={`shrink-0 rounded-full px-2.5 py-[3px] text-xs font-medium ${debtSeverity ? debtBadge(debtSeverity) : "bg-white text-sleep-ink"}`}>
                {debtSeverity ?? "No data"}
              </span>
            }
          >
            <div>
              <StatValue
                tone="sleep"
                size="tall"
                value={efficiency.endsWith("%") ? efficiency.slice(0, -1) : efficiency}
                unit={efficiency.endsWith("%") ? "%" : undefined}
                unitLarge
                caption={
                  <>
                    Sleep efficiency
                    {staleNight && lastNight && <LastRecordedNightTag nightOf={lastNight.sleepDate} />}
                  </>
                }
              />

              {staleNight && !lastNight && (
                <p className="mt-3 text-xs text-sleep-muted">No recent night recorded</p>
              )}

              {lastNight && (
                <div className="mt-4">
                  {/* Micro stacked bar: segments sum to 100% of container width */}
                  <div className="flex h-1.5 overflow-hidden rounded-full">
                    {lastNight.breakdown.deepPercent  > 0 && <div className="bg-stage-deep"  style={{ width: `${lastNight.breakdown.deepPercent}%`  }} />}
                    {lastNight.breakdown.remPercent   > 0 && <div className="bg-stage-rem"   style={{ width: `${lastNight.breakdown.remPercent}%`   }} />}
                    {lastNight.breakdown.lightPercent > 0 && <div className="bg-stage-light" style={{ width: `${lastNight.breakdown.lightPercent}%` }} />}
                    {lastNight.breakdown.awakePercent > 0 && <div className="bg-stage-awake" style={{ width: `${lastNight.breakdown.awakePercent}%` }} />}
                  </div>
                  <p className="mt-1.5 text-xs text-sleep-muted">
                    {formatSleepMs(lastNight.totalSleepMs)} total sleep
                    {staleNight && <LastRecordedNightTag nightOf={lastNight.sleepDate} />}
                  </p>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-white/60 pt-4">
                <div>
                  {debtHours !== null
                    ? <><span className="text-lg font-medium">{debtHours} hrs</span><span className="ml-1.5 text-xs text-sleep-muted">accumulated debt</span>{debtBasis && <span className="block text-xs text-sleep-muted">{debtBasis}</span>}</>
                    : <span className="text-xs text-sleep-muted">No data yet</span>}
                </div>
                <span className="text-sm font-medium text-sleep-muted transition-colors group-hover:text-sleep-ink">
                  View details →
                </span>
              </div>
            </div>
          </StatCard>
        </Link>

        {/* Heart Health Card */}
        <Link href="/dashboard/heart" className="group block">
          <StatCard
            tone="heart"
            eyebrow="Heart health"
            size="feature"
            className="h-full"
            topRight={
              <span className={`shrink-0 rounded-full px-2.5 py-[3px] text-xs font-medium ${heartStatusBadge(heartStatus)}`}>
                {heartStatus}
              </span>
            }
          >
            <div>
              <StatValue
                tone="heart"
                size="tall"
                value={latestRhr !== null ? String(latestRhr) : "—"}
                unit={latestRhr !== null ? "bpm" : undefined}
                caption="Resting heart rate"
              />
              <div className="mt-4 flex items-center justify-between border-t border-white/60 pt-4">
                <div>
                  {latestHrv !== null
                    ? <><span className="text-lg font-medium">{latestHrv}</span><span className="ml-1.5 text-xs text-heart-muted">ms HRV</span></>
                    : <span className="text-xs text-heart-muted">No HRV data yet</span>}
                </div>
                <span className="text-sm font-medium text-heart-muted transition-colors group-hover:text-heart-ink">
                  View details →
                </span>
              </div>
            </div>
          </StatCard>
        </Link>

        {/* Exercise & Endurance Card: inactive placeholder */}
        <EmptyStateCard
          eyebrow="Exercise & Endurance"
          className="cursor-not-allowed"
          topRight={
            <span className="shrink-0 rounded-full bg-surface-container px-2.5 py-[3px] text-xs font-medium text-on-surface-variant">
              Inactive
            </span>
          }
        >
          <div>
            <p className="flex items-baseline gap-x-2.5">
              <span className="font-display text-[80px] font-light leading-[0.9] tracking-[-0.035em] text-on-surface-variant">0</span>
              <span className="text-[22px] text-on-surface-variant">min</span>
            </p>
            <p className="mt-3 text-sm text-on-surface-variant">Active zone minutes</p>
            <p className="mt-3 text-xs text-on-surface-variant">Waiting for database migrations and normalizers.</p>
          </div>
        </EmptyStateCard>

      </div>
    </PageShell>
  );
}
