"use server";

import { PageShell, PageTitle } from "../../components/page-shell";
import Link from "next/link";
import { auth } from "@/auth";
import { loadPageData } from "@/app/actions/sync";
import { readHrSummaries } from "@/lib/sync/read";
import NightHeartChart from "../../components/night-heart-chart";
import MissingNightCard from "../../components/missing-night-card";
import DateNavigator from "../../components/date-navigator";
import HrTrendChart from "./hr-trend-chart";
import RecoveryBalanceChart from "./recovery-balance-chart";
import { localToday, addDays } from "@/lib/dates";
import { formatClockTime, formatNightRange } from "@/lib/format";
import { EYEBROW, EmptyStateCard, NeutralCard } from "../../components/stat-card";
import { BASELINE_LOOKBACK_DAYS } from "@/lib/charts/rolling-baseline";
import { WINDOW_DAYS } from "@/lib/analytics/hr-trends";
import { calculateStageHr } from "@/lib/analytics/sleep";

export default async function HeartRateDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  const params = await searchParams;
  const targetDate = params.date || localToday();

  // Per-night graph data — reads ?date= and lazy-fetches samples if needed.
  let data: Awaited<ReturnType<typeof loadPageData>> | undefined;
  try {
    data = await loadPageData(targetDate);
  } catch (error) {
    console.error("Heart rate detail page error:", error);
  }

  // The picked date implies one night. When it has no session, data.lastNight is
  // an older night: never show it here, only offer a link to it.
  const selected = data?.hasData === true ? data.selectedNight : null;
  const missingNight = selected?.status === "missing" ? selected : null;
  if (data?.hasData === true && missingNight) {
    data = { ...data, lastNight: null, nightHeart: null, nightHrSeries: [] };
  }
  const nightLabel = selected?.status === "recorded" ? formatNightRange(selected.nightOf) : null;

  // Per-stage HR averages — derived from the same data loaded above, no new fetch.
  const stageHr =
    data?.hasData && data.lastNight?.timeline && data.nightHrSeries.length > 1
      ? calculateStageHr(data.nightHrSeries, data.lastNight.timeline)
      : null;

  // Trend data — anchored to today regardless of the selected night.
  // Fetch 2× the widest window so prevWindowAvgRhr is always computable, and never
  // less than the widest window plus the baseline lookback (28 days before its start).
  const today = localToday();
  const maxWindowDays = Math.max(...(Object.values(WINDOW_DAYS) as number[]));
  const trendStartDate = addDays(
    today,
    -Math.max(2 * maxWindowDays - 1, maxWindowDays - 1 + BASELINE_LOOKBACK_DAYS),
  );
  const summaries = await readHrSummaries(userId, trendStartDate, today);

  return (
    <PageShell>

      {/* Back link */}
      <Link
        href={`/dashboard/sleep?date=${targetDate}`}
        className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
      >
        ← Sleep
      </Link>

      {!data || !data.hasData ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <PageTitle className="mb-2">Overnight Heart Rate</PageTitle>
              <p className="text-base text-on-surface-variant max-w-xl">
                Beats per minute across the night. Dips below the dashed line mark restorative stretches.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <DateNavigator />
            </div>
          </div>
          <EmptyStateCard eyebrow="Overnight heart rate">
            <div>
              <p className="text-base text-on-surface">No sleep data found</p>
              <p className="mt-1 text-sm text-on-surface-variant">Sync your device data to populate this view.</p>
            </div>
          </EmptyStateCard>
        </>
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <PageTitle className="mb-2">Overnight Heart Rate</PageTitle>
              <p className="text-base text-on-surface-variant max-w-xl">
                {data.lastNight ? (
                  <>
                    {nightLabel && <>{nightLabel}<span className="mx-2 text-outline-variant">·</span></>}
                    {formatClockTime(data.lastNight.startTime, data.lastNight.startUtcOffsetSeconds)}
                    <span className="mx-2 text-outline-variant">–</span>
                    {formatClockTime(data.lastNight.endTime, data.lastNight.endUtcOffsetSeconds)}
                  </>
                ) : (
                  missingNight
                    ? formatNightRange(missingNight.expectedNightOf)
                    : "Beats per minute across the night. Dips below the dashed line mark restorative stretches."
                )}
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <DateNavigator />
            </div>
          </div>

          {/* Chart or empty state */}
          {missingNight ? (
            <div className="space-y-3">
              <MissingNightCard
                expectedNightOf={missingNight.expectedNightOf}
                isToday={targetDate === today}
              />
              {missingNight.fallbackNightOf && (
                <Link
                  href={`/dashboard/sleep/heart-rate?date=${addDays(missingNight.fallbackNightOf, 1)}`}
                  className="inline-block text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  View most recent recorded night →
                </Link>
              )}
            </div>
          ) : data.lastNight && data.nightHrSeries.length > 1 ? (
            <NeutralCard>
              <div className="mb-6">
                <h2 className={`${EYEBROW} text-on-surface-variant`}>Heart rate curve</h2>
                <p className="mt-1.5 text-sm text-on-surface-variant">
                  Beats per minute across the night — dips below the dashed line mark restorative stretches.
                </p>
              </div>
              <NightHeartChart
                series={data.nightHrSeries}
                sessionStart={data.lastNight.startTime}
                sessionEnd={data.lastNight.endTime}
                startUtcOffsetSeconds={data.lastNight.startUtcOffsetSeconds}
                endUtcOffsetSeconds={data.lastNight.endUtcOffsetSeconds}
                baselineRhr={data.nightHeart?.baselineRhr ?? data.heart?.overallBaseline?.avgRhr ?? null}
                timeline={data.lastNight.timeline ?? undefined}
              />

              {/* Avg HR by stage — deep→light→REM→awake (low-to-high HR gradient) */}
              {stageHr && (
                <div className="mt-4 pt-4 border-t border-hairline grid grid-cols-4 gap-4">
                  {(["deep", "light", "rem", "awake"] as const).map((stage) => {
                    const LABELS = { deep: "Deep", light: "Light", rem: "REM", awake: "Awake" } as const;
                    const entry = stageHr[stage];
                    return (
                      <div key={stage}>
                        <p className="text-xs text-on-surface-variant mb-0.5">{LABELS[stage]}</p>
                        <p className="font-display text-lg font-bold text-on-surface">
                          {entry.avgBpm !== null
                            ? <>{entry.avgBpm}<span className="text-sm font-normal text-on-surface-variant ml-0.5">bpm</span></>
                            : <span className="text-on-surface-variant">—</span>}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </NeutralCard>
          ) : (
            <EmptyStateCard eyebrow="Heart rate curve">
              <div>
                <p className="text-base text-on-surface">No heart rate samples for this night</p>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Heart rate samples are fetched on first view — try navigating away and back.
                </p>
              </div>
            </EmptyStateCard>
          )}

          {/* ── HR trend — anchored to today, independent of ?date= ── */}
          {/* HrTrendChart renders its own card shell; no wrapper needed here */}
          <HrTrendChart summaries={summaries} lastSyncedAt={data?.lastSyncedAt ?? null} />

          {/* ── Recovery vs Normal — z-scores against 90-day baseline ── */}
          <RecoveryBalanceChart summaries={summaries} lastSyncedAt={data?.lastSyncedAt ?? null} />
        </>
      )}
    </PageShell>
  );
}
