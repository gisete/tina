"use server";

import { PageShell, PageTitle } from "../components/page-shell";
import Link from "next/link";
import type { ReactNode } from "react";
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
import ArchitectureCard, { type ArchitectureRow } from "../components/architecture-card";
import { EYEBROW, EmptyStateCard, NeutralCard, StatCard, StatDuration, StatPill, StatValue } from "../components/stat-card";
import { FEELING_TAGS } from "@/lib/analytics/feeling-tags";
import { SLEEP_SCORE_TARGET, summarizeNightTotals } from "@/lib/analytics/sleep";
import MissingNightCard from "../components/missing-night-card";
import { addDays, localToday } from "@/lib/dates";
import { formatClockTime, formatDurationMins, formatNightRange, splitDurationMins } from "@/lib/format";

function HowIFelt({ logged, className, children }: { logged: boolean; className: string; children: ReactNode }) {
  return logged ? (
    <NeutralCard className={`${className} !p-7`}>
      <h2 className={`${EYEBROW} mb-4 text-on-surface-variant`}>How I felt</h2>
      {children}
    </NeutralCard>
  ) : (
    <EmptyStateCard eyebrow="How I felt" className={className}>
      {children}
    </EmptyStateCard>
  );
}

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

  // The night the picked date implies may not exist. Then data.lastNight is an
  // older night: show it only as a labelled fallback (today), never for a past
  // date, and never under the picked date as if it were that night.
  const selected = data?.hasData === true ? data.selectedNight : null;
  const missingNight = selected?.status === "missing" ? selected : null;
  const fallbackNightOf = missingNight?.fallbackNightOf ?? null;
  if (data?.hasData === true && missingNight && fallbackNightOf === null) {
    data = { ...data, lastNight: null, nightHeart: null };
  }

  // "How I felt" and the heart-rate link follow the DISPLAYED night, not the picker date.
  const nightOf = data?.hasData === true && data.lastNight ? data.lastNight.sleepDate : null;
  const initialTagIds = nightOf ? await readNightFeeling(userId, nightOf) : [];

  const night = data?.hasData === true ? data.lastNight : null;
  const totals = night ? summarizeNightTotals(night.totalSleepMs, night.startTime, night.endTime) : null;
  const asleep = splitDurationMins(totals?.asleepMins ?? 0);
  const hasLoggedFeeling = initialTagIds.some((id) => FEELING_TAGS.some((t) => t.id === id));

  const nightHeart = data?.hasData === true ? data.nightHeart : null;
  const restingHr = nightHeart?.restingHr ?? null;
  const heartStatus = nightHeart && nightHeart.status !== "insufficient" ? nightHeart.status : null;
  const heartCaption = nightHeart
    ? [nightHeart.hrv != null ? `${nightHeart.hrv} ms HRV` : null, nightHeart.baselineRhr != null ? `baseline ${nightHeart.baselineRhr} bpm` : null]
        .filter((p): p is string => p !== null)
        .join(" · ") || null
    : null;
  const heartLink = nightOf ? `/dashboard/sleep/heart-rate?date=${addDays(nightOf, 1)}` : null;

  const arch = data?.hasData === true ? data.analytics?.architecture : null;
  const architectureRows: ArchitectureRow[] = night
    ? [
        {
          key: "deep", name: "Deep sleep", blurb: "Physical recovery & muscular restoration",
          pct: arch?.deepPercentage || 0, targetLo: 15, targetHi: 20,
          status: night.continuity?.status ?? null,
          explainer: night.continuity ? <ContinuityExplainer stage="deep" data={night.continuity} /> : null,
        },
        {
          key: "rem", name: "REM sleep", blurb: "Cognitive filing & mental clarity consolidation",
          pct: arch?.remPercentage || 0, targetLo: 20, targetHi: 25,
          status: null,
          explainer: night.remContinuity ? <ContinuityExplainer stage="rem" data={night.remContinuity} /> : null,
        },
        {
          key: "light", name: "Light sleep", blurb: "Transitionary bridge & basal processing",
          pct: arch?.lightPercentage || 0, targetLo: 50, targetHi: 60,
          status: night.lightStability?.status ?? null,
          explainer: night.lightStability ? <ContinuityExplainer stage="light" data={night.lightStability} /> : null,
        },
      ]
    : [];

  return (
    <PageShell>

      {/* Page headline */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Sleep Intelligence</PageTitle>
        <div className="flex items-center gap-2.5">
          <SyncButton lastSyncedAt={data?.lastSyncedAt ?? null} />
        </div>
      </div>

      {!data || !data.hasData ? (
        <EmptyStateCard eyebrow="Sleep">
          <div>
            <p className="text-base text-on-surface">No sleep data found</p>
            <p className="mt-1 text-sm text-on-surface-variant">
              Trigger your synchronization loop to pull records from your Fitbit profile.
            </p>
          </div>
        </EmptyStateCard>
      ) : (
        <div className="space-y-10">

          {/* ════ SELECTED NIGHT ════════════════════════════════════════════ */}
          <div className="space-y-5">

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`${EYEBROW} text-on-surface-variant`}>Selected night</p>
                <p className="mt-1.5 text-base text-secondary">
                  {formatNightRange(missingNight ? missingNight.expectedNightOf : (nightOf ?? targetDate))}
                  {!missingNight && night && <> · {formatClockTime(night.startTime)} – {formatClockTime(night.endTime)}</>}
                </p>
              </div>
              <DateNavigator />
            </div>

            {missingNight && (
              <MissingNightCard
                expectedNightOf={missingNight.expectedNightOf}
                isToday={targetDate === localToday()}
              />
            )}

            {fallbackNightOf && night && (
              <div className="pt-2">
                <p className={`${EYEBROW} text-on-surface-variant`}>Most recent recorded night</p>
                <p className="mt-1.5 text-base text-secondary">
                  {formatNightRange(fallbackNightOf)} · {formatClockTime(night.startTime)} – {formatClockTime(night.endTime)}
                </p>
              </div>
            )}

            {night && totals && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-6">

                {/* Score */}
                <StatCard
                  tone="sleep"
                  shade="strong"
                  size="feature"
                  eyebrow="Sleep score"
                  topRight={<StatPill tone="sleep">Target &gt;{SLEEP_SCORE_TARGET}</StatPill>}
                  className="md:col-span-2"
                >
                  <StatValue
                    tone="sleep"
                    size="feature"
                    value={String(night.holisticScore)}
                    unit="/ 100"
                    caption={<a href="#score-breakdown" className="font-medium text-sleep-ink hover:underline">How this is calculated</a>}
                  />
                </StatCard>

                {/* Total sleep */}
                <StatCard tone="sleep" shade="soft" size="tall" eyebrow="Total sleep" className="md:col-span-2">
                  <StatDuration
                    tone="sleep"
                    size="tall"
                    hours={asleep.hours}
                    minutes={asleep.minutes}
                    caption={`${formatDurationMins(totals.inBedMins)} in bed`}
                  />
                </StatCard>

                {/* Efficiency */}
                <StatCard tone="sleep" shade="soft" size="tall" eyebrow="Efficiency" className="md:col-span-2">
                  <StatValue
                    tone="sleep"
                    size="tall"
                    value={totals.efficiency === null ? "—" : String(Math.round(totals.efficiency * 100))}
                    unit={totals.efficiency === null ? undefined : "%"}
                    unitLarge
                    caption={totals.efficiency === null ? undefined : `${formatDurationMins(totals.awakeInBedMins)} awake in bed`}
                  />
                </StatCard>

                {/* How I felt: dashed until something is logged */}
                {nightOf && (
                  <HowIFelt logged={hasLoggedFeeling} className="md:col-span-3">
                    <NightFeelingInput
                      key={nightOf}
                      nightOf={nightOf}
                      initialTagIds={initialTagIds}
                      isCurrentNight={!missingNight && targetDate === localToday()}
                    />
                  </HowIFelt>
                )}

                {/* Night heart rate */}
                {nightOf && heartLink && (
                  restingHr !== null ? (
                    <StatCard
                      tone="heart"
                      eyebrow="Night heart rate"
                      className="md:col-span-3"
                      topRight={heartStatus ? <StatPill tone="heart"><span className="capitalize">{heartStatus}</span></StatPill> : undefined}
                    >
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <StatValue tone="heart" size="tile" value={String(restingHr)} unit="bpm" caption={heartCaption ?? undefined} />
                        <Link href={heartLink} className="text-sm font-medium text-heart-ink hover:underline">See more →</Link>
                      </div>
                    </StatCard>
                  ) : (
                    <EmptyStateCard
                      eyebrow="Night heart rate"
                      className="md:col-span-3"
                      topRight={<Link href={heartLink} className="text-sm font-medium text-on-surface-variant hover:text-on-surface">See more →</Link>}
                    >
                      <p className="text-xl text-on-surface">Awaiting overnight readings</p>
                    </EmptyStateCard>
                  )
                )}

                {/* Sleep timeline */}
                <NeutralCard className="md:col-span-6">
                  <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className={`${EYEBROW} text-on-surface-variant`}>Sleep timeline</h2>
                    <p className="text-sm text-on-surface-variant">
                      {formatClockTime(night.startTime)} – {formatClockTime(night.endTime)}
                    </p>
                  </div>
                  <HypnogramChart
                    timeline={night.timeline}
                    sessionStart={night.startTime}
                    sessionEnd={night.endTime}
                    restlessEvents={night.restlessness.restlessEvents}
                    restlessnessSource={night.restlessness.source}
                    bare
                  />
                </NeutralCard>

                {/* Architecture */}
                <ArchitectureCard rows={architectureRows} className="md:col-span-6" />

                {/* Score breakdown: target of "How this is calculated" */}
                <div id="score-breakdown" className="md:col-span-6 scroll-mt-6">
                  <SleepScoreCard score={night.holisticScore || 0} breakdown={night.holisticBreakdown} compact />
                </div>

              </div>
            )}

          </div>{/* end Selected Night */}

          {/* ════ CURRENT STATUS · as of today ══════════════════════════════ */}
          <div className="space-y-4">

            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 className={`${EYEBROW} text-on-surface-variant`}>Current status</h2>
              <span className="text-sm text-on-surface-variant">· as of today</span>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">

              {/* Sleep Debt — link to detail page. The "high" badge stays red (warning). */}
              <Link href="/dashboard/sleep/debt" className="group block">
                <StatCard
                  tone="sleep"
                  eyebrow="Sleep debt"
                  className="h-full"
                  topRight={
                    <span className={`shrink-0 rounded-full px-2.5 py-[3px] text-xs font-medium ${
                      data.currentState.debt.severity === "high"     ? "bg-red-100 text-red-700" :
                      data.currentState.debt.severity === "moderate" ? "bg-amber-100 text-amber-700" :
                      "bg-white text-sleep-ink"
                    }`}>
                      {data.currentState.debt.severity}
                    </span>
                  }
                >
                  <div>
                    <StatValue
                      tone="sleep"
                      size="tile"
                      value={String(data.currentState.debt.cumulativeDebtHours)}
                      unit="hrs"
                      caption="Decay-weighted deficit over the last 14 nights"
                    />
                    <p className="mt-3 text-right text-sm font-medium text-sleep-muted transition-colors group-hover:text-sleep-ink">
                      View history →
                    </p>
                  </div>
                </StatCard>
              </Link>

              {/* Circadian Rhythm */}
              <StatCard
                tone="sleep"
                eyebrow="Circadian rhythm"
                topRight={<StatPill tone="sleep">{data.currentState.variance?.status || "Stable"}</StatPill>}
              >
                <StatValue
                  tone="sleep"
                  size="tile"
                  value={`±${data.currentState.variance?.standardDeviationMinutes || 0}`}
                  unit="m"
                  caption="Bedtime variance over the last 14 nights"
                />
              </StatCard>

            </div>

          </div>{/* end Current Status */}

          {/* ════ SLEEP SCORE TREND ══════════════════════════════════════════ */}
          <SleepCharts data={(data.chartTimeline || []).map(({ date, sleepScore }) => ({ date, sleepScore }))} />

        </div>
      )}
    </PageShell>
  );
}
