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
// Per-metric config — unchanged structure
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

// Fixed YAxis width shared by both charts so their plot areas share the same left edge.
// Without this, Recharts auto-sizes each axis independently (bpm ticks vs ms ticks differ
// in rendered width), offsetting the two x-axes and breaking vertical date alignment.
const Y_AXIS_W = 40;

// Target number of visible x-axis labels regardless of window length.
const TICK_TARGET = 7;

// ---------------------------------------------------------------------------
// Metric section — presentational, no shell, no hooks
// ---------------------------------------------------------------------------

function HrMetricCard({
  metric,
  result,
  activeWindow,
}: {
  metric: HrMetric;
  result: HrTrendResult;
  activeWindow: HrWindow;
}) {
  const cfg = METRIC_CONFIG[metric];
  const { points, stats } = result;

  const chartData = points.map((p) => ({
    displayDate:      formatDateMMDD(p.date),
    restingHeartRate: p.restingHeartRate,
    hrv:              p.hrv,
  }));

  // Which indices get a visible x-axis label — ~7 evenly spread, always first + last.
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
              <Tooltip
                contentStyle={{ backgroundColor: "#1c1c16", borderRadius: "8px", border: "none" }}
                labelStyle={{ color: "#ffffff", fontFamily: "var(--font-display)", fontWeight: "bold" }}
                itemStyle={{ color: "#e5e2d9", fontFamily: "var(--font-sans)" }}
                formatter={(value, name) => {
                  if (typeof value !== "number") return [value, name];
                  return [`${value} ${cfg.unit}`, cfg.seriesLabel];
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
              <Line
                type="monotone"
                dataKey={cfg.dataKey}
                stroke="var(--color-heart-accent)"
                strokeWidth={2}
                dot={activeWindow === "90d"
                  ? false
                  : (dotProps: DotItemDotProps) => {
                      // White-fill + indigo-ring marker per real night; null/gap days get nothing.
                      // stroke via style so var() resolves — SVG presentation attrs don't support it.
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
            </LineChart>
          </ResponsiveContainer>
        </div>
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
// Section — single card shell, shared window control, stacked metric sections
// ---------------------------------------------------------------------------

interface Props {
  summaries: DailyHrSummary[];
}

export default function HrTrendChart({ summaries }: Props) {
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

  // Engine called once — result.stats carries both RHR and HRV; both sections read from it.
  const result = calculateHrTrends(summaries, activeWindow, localToday());

  return (
    <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">
      {/* Card header: title + caption left, window pills right */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">Recovery Trends</h2>
          <p className="text-sm text-on-surface-variant mt-1">
            As of today. Dashed line = window average.
          </p>
        </div>
        <div className="flex gap-2">
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
      </div>

      <HrMetricCard metric="rhr" result={result} activeWindow={activeWindow} />

      <div className="my-8 border-t border-outline-variant/50" />

      <HrMetricCard metric="hrv" result={result} activeWindow={activeWindow} />
    </div>
  );
}
