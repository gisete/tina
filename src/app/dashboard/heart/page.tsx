"use server";

import { PageShell, PageTitle } from "../components/page-shell";
import { auth } from "@/auth";
import { loadPageData } from "@/app/actions/sync";
import { readActivitySummaries } from "@/lib/sync/read";
import SyncButton from "../components/sync-button";
import { EYEBROW, EmptyStateCard, StatCard, StatPill, StatValue } from "../components/stat-card";
import HeartCharts from "../components/heart-charts";
import DateNavigator from "../components/date-navigator";
import AzmTrendCard from "../components/azm-trend-card";
import { localToday, addDays } from "@/lib/dates";

function statusBadge(status: string): string {
  if (status === "Elevated Stress") return "bg-amber-100 text-amber-700";
  return "bg-white text-heart-ink";
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
    <PageShell>

      {/* Page Headline */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-2">Heart Health</PageTitle>
          <p className="text-base text-on-surface-variant max-w-2xl">
            Monitor resting heart rate and HRV trends to gauge cardiovascular fitness and daily autonomic recovery load.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SyncButton lastSyncedAt={data?.lastSyncedAt ?? null} />
          <DateNavigator />
        </div>
      </div>

      {/* AZM trend — always rendered; anchored to today regardless of ?date= */}
      <AzmTrendCard rows={activityRows} />

      {!hasHeartData ? (
        <EmptyStateCard eyebrow="Heart">
          <div>
            <p className="text-base text-on-surface">No heart data found</p>
            <p className="mt-1 text-sm text-on-surface-variant">
              Trigger your synchronization loop to pull records from your Fitbit profile.
            </p>
          </div>
        </EmptyStateCard>
      ) : (
        <div className="space-y-7">

          {/* Metric Cards */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">

            <StatCard tone="heart" eyebrow="Resting heart rate" topRight={<StatPill tone="heart">Target &lt;60 bpm</StatPill>}>
              <StatValue
                tone="heart"
                size="tile"
                value={latestRhr !== null ? String(latestRhr) : "—"}
                unit={latestRhr !== null ? "bpm" : undefined}
                caption={avgRhr !== null ? `${avgRhr} bpm historical average` : "Latest recorded reading"}
              />
            </StatCard>

            <StatCard tone="heart" eyebrow="HRV (RMSSD)" topRight={<StatPill tone="heart">Target &gt;50 ms</StatPill>}>
              <StatValue
                tone="heart"
                size="tile"
                value={latestHrv !== null ? String(latestHrv) : "—"}
                unit={latestHrv !== null ? "ms" : undefined}
                caption={avgHrv !== null ? `${avgHrv} ms historical average` : "Overnight RMSSD measurement"}
              />
            </StatCard>

            <StatCard
              tone="heart"
              eyebrow="Recovery status"
              topRight={
                <span className={`shrink-0 rounded-full px-2.5 py-[3px] text-xs font-medium ${statusBadge(latestStatus)}`}>
                  {latestStatus}
                </span>
              }
            >
              <StatValue
                tone="heart"
                size="tile"
                value={baselineRhr !== null ? String(baselineRhr) : "—"}
                unit={baselineRhr !== null ? "bpm" : undefined}
                caption={
                  baselineRhr !== null
                    ? `7-day rolling baseline${baselineHrv !== null ? ` · ${baselineHrv} ms HRV` : ""}`
                    : "Building baseline — more data needed"
                }
              />
            </StatCard>

          </div>

          {/* Historical Timeline Charts: each chart is its own NeutralCard */}
          <div>
            <div className="mb-5">
              <h2 className={`${EYEBROW} text-on-surface-variant`}>Historical trends</h2>
              <p className="mt-1.5 text-sm text-on-surface-variant">
                Solid lines show daily readings. Dashed lines show the rolling 7-day baseline used for anomaly detection.
              </p>
            </div>
            <HeartCharts data={daily} />
          </div>

        </div>
      )}
    </PageShell>
  );
}
