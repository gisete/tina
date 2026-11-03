"use client";

// Gap-aware area trend chart: solid line + soft fill over present days, dotted
// two-point bridges across interior gaps, baseline ticks on absent days, anchor
// dots on isolated scores, and "No reading" hover text. Used by the Sleep Score
// Trend and (next) the Heart page cards. Presentation only: every number comes
// from the series it is given; absent days are never imputed.

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { SeriesPoint } from "@/lib/analytics/hr-trends";
import { localToday } from "@/lib/dates";
import { formatDateMMDD } from "@/lib/format";
import { selectTrendTicks } from "@/lib/charts/trend-ticks";
import type { FitDomainOptions } from "@/lib/charts/trend-domain";
import { buildTrendRows, fitTrendDomain, tooltipLines } from "@/lib/charts/gap-trend-model";
import { bridgeSeriesValues, buildGapModel, isolatedPresentIndices, pendingTodayIndex } from "@/lib/charts/data-gaps";

const TICK_TARGET = 7;

// Gap treatment: muted token colour, no new hex.
const GAP_STROKE = "var(--color-on-surface-variant)";
const ABSENT_TICK_PX = 6;
const ISOLATED_DOT_R = 2; // 4px diameter, same colour as the solid line

interface Props {
  /** One point per calendar day in the window, ascending, nulls preserved (calculateSeriesTrend().points). */
  points: SeriesPoint[];
  /**
   * Optional baseline per day, parallel to `points` (null = none that day). Drawn as a
   * light dashed line with connectNulls; shown in the tooltip (also on days with no
   * actual reading). Joins the y-domain so it is never clipped, but never affects
   * bridges, ticks or isolated dots.
   */
  baseline?: (number | null)[];
  /** Tooltip label for the series, e.g. "Sleep Score". */
  seriesLabel: string;
  /** Appended to tooltip values ("bpm"); empty for unitless. */
  unit?: string;
  /** Line and anchor-dot colour. A CSS value; var(--token) is fine (applied via style, not SVG attributes). */
  color: string;
  /** Top-of-gradient fill colour (fades to transparent). */
  fillColor: string;
  /** Unique per chart on a page: SVG gradient ids are document-global. */
  gradientId: string;
  domain: FitDomainOptions;
  /** True when today's slot cannot hold a value yet (series keyed by night-of date). */
  todayIsPending: boolean;
  /** ISO timestamp of the last sync; decides "Not synced yet" vs "No reading" on recent absent days. */
  lastSyncedAt?: string | null;
  /** Epoch ms "now", computed by the caller (a mount-time snapshot; keeps render pure); used with lastSyncedAt for the absence label. */
  nowMs: number;
  height?: number;
  margin?: { top: number; right: number; left: number; bottom: number };
}

export default function GapTrendChart({
  points,
  baseline,
  seriesLabel,
  unit = "",
  color,
  fillColor,
  gradientId,
  domain,
  todayIsPending,
  lastSyncedAt = null,
  nowMs,
  height = 240,
  margin = { top: 6, right: 10, left: -30, bottom: 0 },
}: Props) {
  const values = points.map((p) => p.value);
  const pendingIdx = pendingTodayIndex(points.map((p) => p.date), values, localToday(), todayIsPending);
  const gaps = buildGapModel(values, { ignoreIndex: pendingIdx });
  const isolated = new Set(isolatedPresentIndices(values));
  const lastSyncedAtMs = lastSyncedAt ? Date.parse(lastSyncedAt) : null;

  const [domainMin, domainMax] = fitTrendDomain(values, baseline, domain);

  const bridgeValues = gaps.bridges.map((b) => bridgeSeriesValues(values, b));

  const chartData = buildTrendRows({
    dates: points.map((p) => p.date),
    displayDates: points.map((p) => formatDateMMDD(p.date)),
    values,
    baseline,
    pendingIdx,
    isolated,
    domainMin,
    bridgeValues,
  });

  const tickIndices = selectTrendTicks(chartData.length, TICK_TARGET);
  const lastIdx = chartData.length - 1;

  return (
    <>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={margin}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  style={{ stopColor: fillColor }} stopOpacity={0.8} />
                <stop offset="95%" style={{ stopColor: fillColor }} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="#f6f4ea" vertical={false} />
            <XAxis
              dataKey="displayDate"
              stroke="#787869"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              style={{ fontFamily: "var(--font-sans)" }}
              interval={0}
              tick={({ x, y, payload, index }) => (
                <text
                  x={x}
                  y={Number(y) + 12}
                  fontSize={12}
                  fill="#787869"
                  // The last label is end-anchored so it is not clipped by the plot's right edge.
                  textAnchor={index === lastIdx ? "end" : "middle"}
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {tickIndices.has(index) ? payload.value : ""}
                </text>
              )}
            />
            <YAxis
              domain={[domainMin, domainMax]}
              stroke="#787869"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              style={{ fontFamily: "var(--font-sans)" }}
            />
            <Tooltip
              content={({ active, label }) => {
                if (!active) return null;
                const row = chartData.find((r) => r.displayDate === label);
                if (!row || row.pending) return null;
                const { text, baseline: base } = tooltipLines(row, seriesLabel, unit, {
                  today: localToday(),
                  lastSyncedAtMs,
                  nowMs,
                });
                return (
                  <div style={{ backgroundColor: "#1c1c16", borderRadius: 8, padding: "10px 12px" }}>
                    <p style={{ color: "#ffffff", fontFamily: "var(--font-display)", fontWeight: "bold", margin: 0 }}>{label}</p>
                    <p style={{ color: "#e5e2d9", fontFamily: "var(--font-sans)", margin: "4px 0 0" }}>{text}</p>
                    {base && <p style={{ color: "#e5e2d9", fontFamily: "var(--font-sans)", margin: "2px 0 0" }}>{base}</p>}
                  </div>
                );
              }}
            />
            {baseline && (
              <Line
                dataKey="baseline"
                type="linear"
                stroke="#9ca3af"
                strokeWidth={1.25}
                strokeDasharray="5 4"
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
                legendType="none"
              />
            )}
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              style={{ stroke: color }}
              strokeWidth={2}
              fillOpacity={1}
              fill={`url(#${gradientId})`}
              connectNulls={false}
            />
            {/* One two-point dotted segment per bridge. connectNulls only spans the
                nulls inside that bridge: its series holds just the two real endpoints. */}
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
            {/* Baseline tick at every absent day (leading, interior, trailing). */}
            <Line
              dataKey="absentTick"
              stroke="none"
              activeDot={false}
              isAnimationActive={false}
              legendType="none"
              dot={({ cx, cy, index }) =>
                cx == null || cy == null ? <g key={index} /> : (
                  <line
                    key={index}
                    x1={cx}
                    x2={cx}
                    y1={cy - ABSENT_TICK_PX}
                    y2={cy}
                    stroke={GAP_STROKE}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                )
              }
            />
            {/* Visible anchor for a score whose neighbours are both absent. */}
            <Line
              dataKey="isolatedDot"
              stroke="none"
              activeDot={false}
              isAnimationActive={false}
              legendType="none"
              dot={({ cx, cy, index }) =>
                cx == null || cy == null ? <g key={index} /> : <circle key={index} cx={cx} cy={cy} r={ISOLATED_DOT_R} style={{ fill: color }} />
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {(gaps.bridges.length > 0 || gaps.absentIndices.length > 0) && (
        <p className="mt-3 text-xs text-on-surface-variant">Dotted line or gray tick: no reading that day.</p>
      )}
    </>
  );
}
