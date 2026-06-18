"use server";

import Link from "next/link";
import { auth } from "@/auth";
import { loadPageData } from "@/app/actions/sync";
import { readHrSummaries } from "@/lib/sync/read";
import NightHeartChart from "../../components/night-heart-chart";
import DateNavigator from "../../components/date-navigator";
import HrTrendChart from "./hr-trend-chart";
import RecoveryBalanceChart from "./recovery-balance-chart";
import AutoSync from "../../components/auto-sync";
import { localToday, addDays } from "@/lib/dates";
import { formatClockTime } from "@/lib/format";
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

  // Per-stage HR averages — derived from the same data loaded above, no new fetch.
  const stageHr =
    data?.hasData && data.lastNight?.timeline && data.nightHrSeries.length > 1
      ? calculateStageHr(data.nightHrSeries, data.lastNight.timeline)
      : null;

  // Trend data — anchored to today regardless of the selected night.
  // Fetch 2× the widest window so prevWindowAvgRhr is always computable.
  const today = localToday();
  const maxWindowDays = Math.max(...(Object.values(WINDOW_DAYS) as number[]));
  const trendStartDate = addDays(today, -(2 * maxWindowDays - 1));
  const summaries = await readHrSummaries(userId, trendStartDate, today);

  return (
    <div className="p-margin-mobile md:p-margin-desktop max-w-7xl mx-auto py-10 pb-24 space-y-6">

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
              <h1 className="font-display text-4xl font-bold text-black mb-2 tracking-tight">Overnight Heart Rate</h1>
              <p className="text-base text-on-surface-variant max-w-xl">
                Beats per minute across the night. Dips below the dashed line mark restorative stretches.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <AutoSync shouldSync={data?.shouldAutoSync ?? false} />
              <DateNavigator />
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-dashed border-outline-variant bg-white p-12 text-center">
            <h3 className="font-display text-sm font-semibold text-on-surface">No sleep data found</h3>
            <p className="mt-1 text-sm text-on-surface-variant">
              Sync your device data to populate this view.
            </p>
          </div>
        </>
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <h1 className="font-display text-4xl font-bold text-black mb-2 tracking-tight">Overnight Heart Rate</h1>
              <p className="text-base text-on-surface-variant max-w-xl">
                {data.lastNight ? (
                  <>
                    {formatClockTime(data.lastNight.startTime)}
                    <span className="mx-2 text-outline-variant">–</span>
                    {formatClockTime(data.lastNight.endTime)}
                  </>
                ) : (
                  "Beats per minute across the night. Dips below the dashed line mark restorative stretches."
                )}
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <AutoSync shouldSync={data?.shouldAutoSync ?? false} />
              <DateNavigator />
            </div>
          </div>

          {/* Chart or empty state */}
          {data.lastNight && data.nightHrSeries.length > 1 ? (
            <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">
              <div className="mb-6">
                <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">Heart Rate Curve</h2>
                <p className="font-sans text-sm text-on-surface-variant mt-1">
                  Beats per minute across the night — dips below the dashed line mark restorative stretches.
                </p>
              </div>
              <NightHeartChart
                series={data.nightHrSeries}
                sessionStart={data.lastNight.startTime}
                sessionEnd={data.lastNight.endTime}
                baselineRhr={data.nightHeart?.baselineRhr ?? data.heart?.overallBaseline?.avgRhr ?? null}
                timeline={data.lastNight.timeline ?? undefined}
              />

              {/* Avg HR by stage — deep→light→REM→awake (low-to-high HR gradient) */}
              {stageHr && (
                <div className="mt-4 pt-4 border-t border-outline-variant/50 grid grid-cols-4 gap-4">
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
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-outline-variant bg-white p-12 text-center">
              <h3 className="font-display text-sm font-semibold text-on-surface">No heart rate samples for this night</h3>
              <p className="mt-1 text-sm text-on-surface-variant">
                Heart rate samples are fetched on first view — try navigating away and back.
              </p>
            </div>
          )}

          {/* ── HR trend — anchored to today, independent of ?date= ── */}
          {/* HrTrendChart renders its own card shell; no wrapper needed here */}
          <HrTrendChart summaries={summaries} />

          {/* ── Recovery vs Normal — z-scores against 90-day baseline ── */}
          <RecoveryBalanceChart summaries={summaries} />
        </>
      )}
    </div>
  );
}
