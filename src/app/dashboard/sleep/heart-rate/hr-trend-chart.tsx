"use client";

import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  calculateHrTrends,
  trendSentiment,
  type DailyHrSummary,
  type HrWindow,
  type HrMetric,
  type HrTrendStats,
  type HrTrendResult,
  type SeriesPoint,
} from "@/lib/analytics/hr-trends";
import { localToday } from "@/lib/dates";
import type { FitDomainOptions } from "@/lib/charts/trend-domain";
import GapTrendChart from "../../components/gap-trend-chart";
import ExpandableCard from "../../components/expandable-card";

// ---------------------------------------------------------------------------
// Window filter
// ---------------------------------------------------------------------------

function isValidWindow(s: string | null): s is HrWindow {
  return s === "week" || s === "month" || s === "90d";
}

const WINDOWS: Array<{ key: HrWindow; label: string }> = [
  { key: "week",  label: "7 days"  },
  { key: "month", label: "30 days" },
  { key: "90d",   label: "90 days" },
];

const PILL_ACTIVE   = "bg-on-surface text-white";
const PILL_INACTIVE = "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

// ---------------------------------------------------------------------------
// Per-metric config — unchanged
// ---------------------------------------------------------------------------

// CSS variables resolve in style, not in SVG presentation attributes; GapTrendChart applies these via style={}.
const HEART_COLOR = "var(--color-heart-accent)";
const HRV_COLOR   = "var(--color-hrv-accent)";
const tint = (c: string) => `color-mix(in srgb, ${c} 30%, transparent)`;

interface MetricConfig {
  title: string;
  subtitle: string;
  unit: string;
  seriesLabel: string;
  dataKey: "restingHeartRate" | "hrv";
  getAvg:    (s: HrTrendStats) => number | null;
  getMin:    (s: HrTrendStats) => number | null;
  getMax:    (s: HrTrendStats) => number | null;
  getNights: (s: HrTrendStats) => number;
  getDelta:  (s: HrTrendStats) => number | null;
  emptyMsg:  string;
  color: string;
  fillColor: string;
  domain: FitDomainOptions;
}

const METRIC_CONFIG: Record<HrMetric, MetricConfig> = {
  rhr: {
    title:       "Resting Heart Rate",
    subtitle:    "Daily resting heart rate as of today. Dashed line = window average.",
    unit:        "bpm",
    seriesLabel: "Resting HR",
    dataKey:     "restingHeartRate",
    getAvg:      (s) => s.windowAvgRhr,
    getMin:      (s) => s.minRhr,
    getMax:      (s) => s.maxRhr,
    getNights:   (s) => s.nightsWithData,
    getDelta:    (s) => s.rhrDeltaVsPrev,
    emptyMsg:    "No resting heart rate data for this period.",
    color:       HEART_COLOR,
    fillColor:   tint(HEART_COLOR),
    domain:      { pad: 2, step: 2, minSpan: 10, floor: 0 },
  },
  hrv: {
    title:       "HRV",
    subtitle:    "Overnight HRV as of today. Dashed line = window average.",
    unit:        "ms",
    seriesLabel: "HRV",
    dataKey:     "hrv",
    getAvg:      (s) => s.windowAvgHrv,
    getMin:      (s) => s.minHrv,
    getMax:      (s) => s.maxHrv,
    getNights:   (s) => s.nightsWithHrv,
    getDelta:    (s) => s.hrvDeltaVsPrev,
    emptyMsg:    "No HRV data for this period.",
    color:       HRV_COLOR,
    fillColor:   tint(HRV_COLOR),
    domain:      { pad: 5, step: 5, minSpan: 10, floor: 0 },
  },
};


// ---------------------------------------------------------------------------
// Metric overview line — one row of the collapsed summary
// ---------------------------------------------------------------------------

function MetricOverviewLine({
  label,
  avg,
  unit,
  delta,
  metric,
}: {
  label: string;
  avg: number | null;
  unit: string;
  delta: number | null;
  metric: HrMetric;
}) {
  const sentiment  = trendSentiment(metric, delta);
  const deltaColor =
    sentiment === "improvement" ? "text-emerald-600" :
    sentiment === "decline"     ? "text-amber-600" :
    "text-on-surface-variant";
  const prefix = delta !== null && delta > 0 ? "+" : "";

  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-on-surface-variant w-20 shrink-0">{label}</span>
      <span className="font-semibold text-on-surface">
        {avg !== null ? (
          <>{avg}<span className="font-normal text-on-surface-variant ml-0.5">{unit}</span></>
        ) : "—"}
      </span>
      {delta !== null && avg !== null && (
        <>
          <span className="text-on-surface-variant">·</span>
          <span className={`font-semibold ${deltaColor}`}>{prefix}{delta}</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric detail section — chart + stat row, unchanged from before
// ---------------------------------------------------------------------------

function HrMetricCard({
  metric,
  result,
  lastSyncedAt,
  nowMs,
}: {
  metric: HrMetric;
  result: HrTrendResult;
  lastSyncedAt: string | null;
  nowMs: number;
}) {
  const cfg = METRIC_CONFIG[metric];
  const { points, stats } = result;

  const series: SeriesPoint[] = points.map((p) => ({ date: p.date, value: p[cfg.dataKey] }));
  const avgValue = cfg.getAvg(stats);
  // Baseline = the window average, the dashed line this card always drew.
  const baseline = avgValue !== null ? series.map(() => avgValue) : undefined;

  const minValue = cfg.getMin(stats);
  const maxValue = cfg.getMax(stats);
  const nights   = cfg.getNights(stats);
  const delta    = cfg.getDelta(stats);

  const sentiment   = trendSentiment(metric, delta);
  const deltaPrefix = delta !== null && delta > 0 ? "+" : "";
  const deltaColor  =
    sentiment === "improvement" ? "text-emerald-600" :
    sentiment === "decline"     ? "text-amber-600" :
    "text-on-surface";

  return (
    <div>
      <p className="text-sm font-semibold text-on-surface mb-4">{cfg.title}</p>

      {nights === 0 ? (
        <div className="flex items-center justify-center h-[200px] text-sm text-on-surface-variant">
          {cfg.emptyMsg}
        </div>
      ) : (
        <GapTrendChart
          points={series}
          baseline={baseline}
          seriesLabel={cfg.seriesLabel}
          unit={cfg.unit}
          color={cfg.color}
          fillColor={cfg.fillColor}
          gradientId={`hrGradient-${metric}`}
          domain={cfg.domain}
          todayIsPending={false}
          lastSyncedAt={lastSyncedAt}
          nowMs={nowMs}
          height={200}
          margin={{ top: 6, right: 10, left: 0, bottom: 0 }}
        />
      )}

      {/* Stat row */}
      <div className="mt-4 pt-4 border-t border-outline-variant/50 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-on-surface-variant mb-0.5">
            Avg {metric === "hrv" ? "HRV" : "RHR"}
          </p>
          <p className="font-display text-lg font-bold text-on-surface">
            {avgValue !== null
              ? <>{avgValue}<span className="text-sm font-normal text-on-surface-variant ml-0.5">{cfg.unit}</span></>
              : <span className="text-on-surface-variant">—</span>}
          </p>
        </div>

        <div>
          <p className="text-xs text-on-surface-variant mb-0.5">Range</p>
          <p className="font-display text-lg font-bold text-on-surface">
            {minValue !== null && maxValue !== null
              ? <>
                  {minValue}
                  <span className="text-sm font-normal text-on-surface-variant mx-1">–</span>
                  {maxValue}
                  <span className="text-sm font-normal text-on-surface-variant ml-0.5">{cfg.unit}</span>
                </>
              : <span className="text-on-surface-variant">—</span>}
          </p>
        </div>

        <div>
          <p className="text-xs text-on-surface-variant mb-0.5">Nights with data</p>
          <p className="font-display text-lg font-bold text-on-surface">{nights}</p>
        </div>

        <div>
          <p className="text-xs text-on-surface-variant mb-0.5">vs prior period</p>
          {delta !== null ? (
            <p className={`font-display text-lg font-bold ${deltaColor}`}>
              {deltaPrefix}{delta}
              <span className="text-sm font-normal text-on-surface-variant ml-0.5">{cfg.unit}</span>
            </p>
          ) : (
            <p className="text-sm text-on-surface-variant">no prior data</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component — owns window state, passes overview + detail into shell
// ---------------------------------------------------------------------------

interface Props {
  summaries: DailyHrSummary[];
  /** ISO timestamp of the last sync; decides "Not synced yet" vs "No reading" on recent absent days. */
  lastSyncedAt?: string | null;
}

export default function HrTrendChart({ summaries, lastSyncedAt = null }: Props) {
  const [nowMs]      = useState(() => Date.now());
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const rawWindow    = searchParams.get("window");
  const activeWindow: HrWindow = isValidWindow(rawWindow) ? rawWindow : "week";

  const setWindow = (w: HrWindow) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("window", w);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const result = calculateHrTrends(summaries, activeWindow, localToday());
  const { stats } = result;

  // Overview: per-metric glance summary — recomputed whenever window changes.
  const overview = (
    <div className="space-y-1.5">
      <MetricOverviewLine
        label="Resting HR"
        avg={stats.windowAvgRhr}
        unit="bpm"
        delta={stats.rhrDeltaVsPrev}
        metric="rhr"
      />
      <MetricOverviewLine
        label="HRV"
        avg={stats.windowAvgHrv}
        unit="ms"
        delta={stats.hrvDeltaVsPrev}
        metric="hrv"
      />
    </div>
  );

  // Detail: window control + two stacked charts + stat blocks.
  const detail = (
    <>
      <div className="flex gap-2 mb-6">
        {WINDOWS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setWindow(key)}
            className={`px-4 py-1.5 text-sm font-semibold rounded-full transition-colors ${
              activeWindow === key ? PILL_ACTIVE : PILL_INACTIVE
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <HrMetricCard metric="rhr" result={result} lastSyncedAt={lastSyncedAt} nowMs={nowMs} />
      <div className="my-8 border-t border-outline-variant/50" />
      <HrMetricCard metric="hrv" result={result} lastSyncedAt={lastSyncedAt} nowMs={nowMs} />
    </>
  );

  return (
    <ExpandableCard title="Recovery Trends" overview={overview} defaultExpanded={false} expandLabel="Show trends">
      {detail}
    </ExpandableCard>
  );
}
