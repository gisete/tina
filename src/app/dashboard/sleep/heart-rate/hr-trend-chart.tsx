"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  type DotItemDotProps,
} from "recharts";
import {
  calculateHrTrends,
  trendSentiment,
  type DailyHrSummary,
  type HrWindow,
  type HrMetric,
  type HrTrendStats,
  type HrTrendResult,
} from "@/lib/analytics/hr-trends";
import { localToday } from "@/lib/dates";
import { formatDateMMDD } from "@/lib/format";
import { selectTrendTicks } from "@/lib/charts/trend-ticks";
import { absenceLabel, absenceText, bridgeSeriesValues, buildGapModel, isolatedPresentIndices } from "@/lib/charts/data-gaps";
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
  },
};

const Y_AXIS_W   = 40;
const TICK_TARGET = 7;

// Gap treatment (same look as the Sleep Score Trend pilot): muted token colour, no new hex.
const GAP_STROKE = "var(--color-on-surface-variant)";
const ABSENT_TICK_PX = 6;
const ISOLATED_DOT_R = 2;

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
  activeWindow,
  lastSyncedAtMs,
}: {
  metric: HrMetric;
  result: HrTrendResult;
  activeWindow: HrWindow;
  lastSyncedAtMs: number | null;
}) {
  const cfg = METRIC_CONFIG[metric];
  const { points, stats } = result;

  // Gaps for THIS metric (RHR and HRV have separate ones). Today's slot is not
  // pending here: a reading dated today can exist, so absenceLabel decides.
  const values = points.map((p) => p[cfg.dataKey]);
  const gaps = buildGapModel(values);
  const bridgeValues = gaps.bridges.map((b) => bridgeSeriesValues(values, b));
  // The solid line already marks every present point except in the 90-day view.
  const isolated = new Set(activeWindow === "90d" ? isolatedPresentIndices(values) : []);

  const chartData = points.map((p, i) => {
    const row: Record<string, number | string | null> = {
      date:             p.date,
      displayDate:      formatDateMMDD(p.date),
      restingHeartRate: p.restingHeartRate,
      hrv:              p.hrv,
      // Baseline tick anchor on the hidden 0..1 axis, so it never moves the main domain.
      absentTick:       values[i] === null ? 0 : null,
      isolatedDot:      isolated.has(i) ? values[i] : null,
    };
    bridgeValues.forEach((vals, k) => { row[`bridge${k}`] = vals[i]; });
    return row;
  });

  const tickIndices = selectTrendTicks(chartData.length, TICK_TARGET);

  const avgValue = cfg.getAvg(stats);
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
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 6, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="4 4" stroke="#f6f4ea" vertical={false} />
              <XAxis
                dataKey="displayDate"
                stroke="#787869"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                style={{ fontFamily: "var(--font-sans)" }}
                interval={0}
                tickFormatter={(value, index) => tickIndices.has(index) ? value : ""}
              />
              <YAxis
                width={Y_AXIS_W}
                stroke="#787869"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                style={{ fontFamily: "var(--font-sans)" }}
                domain={["auto", "auto"]}
              />
              <YAxis yAxisId="gap" hide width={0} domain={[0, 1]} />
              <Tooltip
                content={({ active, label }) => {
                  if (!active) return null;
                  const row = chartData.find((r) => r.displayDate === label);
                  if (!row) return null;
                  const v = row[cfg.dataKey];
                  const text = v !== null
                    ? `${cfg.seriesLabel} : ${v} ${cfg.unit}`
                    : absenceText(absenceLabel(String(row.date), { today: localToday(), lastSyncedAtMs, nowMs: Date.now() }));
                  return (
                    <div style={{ backgroundColor: "#1c1c16", borderRadius: 8, padding: "10px 12px" }}>
                      <p style={{ color: "#ffffff", fontFamily: "var(--font-display)", fontWeight: "bold", margin: 0 }}>{label}</p>
                      <p style={{ color: "#e5e2d9", fontFamily: "var(--font-sans)", margin: "4px 0 0" }}>{text}</p>
                    </div>
                  );
                }}
              />
              {avgValue !== null && (
                <ReferenceLine
                  y={avgValue}
                  stroke="#9ca3af"
                  strokeDasharray="5 4"
                  strokeWidth={1.25}
                  label={{
                    value: `avg ${avgValue} ${cfg.unit}`,
                    position: "insideTopRight",
                    fontSize: 11,
                    fill: "#9ca3af",
                    fontFamily: "var(--font-sans)",
                  }}
                />
              )}
              {/* One two-point dotted segment per bridge, under the solid line. */}
              {bridgeValues.map((_, k) => (
                <Line
                  key={`bridge${k}`}
                  dataKey={`bridge${k}`}
                  type="linear"
                  stroke={GAP_STROKE}
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                  strokeLinecap="round"
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                  legendType="none"
                />
              ))}
              <Line
                type="monotone"
                dataKey={cfg.dataKey}
                stroke="var(--color-heart-accent)"
                strokeWidth={2}
                dot={activeWindow === "90d"
                  ? false
                  : (dotProps: DotItemDotProps) => {
                      const { cx, cy, value, index } = dotProps;
                      if (value == null || cx == null || cy == null) return null;
                      return (
                        <circle
                          key={index}
                          cx={cx}
                          cy={cy}
                          r={3.5}
                          fill="#ffffff"
                          style={{ stroke: "var(--color-heart-accent)" }}
                          strokeWidth={2}
                        />
                      );
                    }
                }
                activeDot={{ r: 5, style: { fill: "var(--color-heart-accent)" }, stroke: "#ffffff", strokeWidth: 2 }}
                connectNulls={false}
              />
              {/* Baseline tick at every absent day. */}
              <Line
                yAxisId="gap"
                dataKey="absentTick"
                stroke="none"
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
                dot={({ cx, cy, index }) =>
                  cx == null || cy == null ? <g key={index} /> : (
                    <line key={index} x1={cx} x2={cx} y1={cy - ABSENT_TICK_PX} y2={cy} stroke={GAP_STROKE} strokeWidth={1.5} strokeLinecap="round" />
                  )
                }
              />
              {/* 90-day view draws no per-point dots: give an isolated score an anchor. */}
              <Line
                dataKey="isolatedDot"
                stroke="none"
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
                dot={({ cx, cy, index }) =>
                  cx == null || cy == null ? <g key={index} /> : <circle key={index} cx={cx} cy={cy} r={ISOLATED_DOT_R} fill="var(--color-heart-accent)" />
                }
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {nights > 0 && (gaps.bridges.length > 0 || gaps.absentIndices.length > 0) && (
        <p className="mt-3 text-xs text-on-surface-variant">Dotted line or gray tick: no reading that day.</p>
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

  const lastSyncedAtMs = lastSyncedAt ? Date.parse(lastSyncedAt) : null;
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

      <HrMetricCard metric="rhr" result={result} activeWindow={activeWindow} lastSyncedAtMs={lastSyncedAtMs} />
      <div className="my-8 border-t border-outline-variant/50" />
      <HrMetricCard metric="hrv" result={result} activeWindow={activeWindow} lastSyncedAtMs={lastSyncedAtMs} />
    </>
  );

  return (
    <ExpandableCard title="Recovery Trends" overview={overview} defaultExpanded={false} expandLabel="Show trends">
      {detail}
    </ExpandableCard>
  );
}
