"use client";

import { useState } from "react";
import {
  calculateSeriesTrend,
  trendSentiment,
  type SeriesPoint,
  type HrWindow,
} from "@/lib/analytics/hr-trends";
import {
  calculateActiveZoneMinutes,
  type DailyActivityRow,
} from "@/lib/analytics/activity";
import { computeAzmBarLayout } from "@/lib/charts/azm-bar-layout";
import { localToday, startOfWeek } from "@/lib/dates";
import { formatDateMMDD } from "@/lib/format";
import { selectTrendTicks } from "@/lib/charts/trend-ticks";
import ExpandableCard from "./expandable-card";

const AZM_WEEKLY_GOAL = 150;

const WINDOWS: Array<{ key: HrWindow; label: string }> = [
  { key: "week",  label: "7 days"  },
  { key: "month", label: "30 days" },
  { key: "90d",   label: "90 days" },
];

const PILL_ACTIVE   = "bg-on-surface text-white";
const PILL_INACTIVE = "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

// Fixed SVG internal coordinate space — SVG scales responsively via viewBox.
const VB_W   = 560;
const VB_H   = 210;
const Y_W    = 32;           // left margin for y-axis labels
const X_H    = 20;           // bottom margin for x-axis labels
const PLOT_W = VB_W - Y_W;  // 528
const PLOT_H = VB_H - X_H;  // 190

const TICK_TARGET = 7;

interface Props {
  rows: DailyActivityRow[];
}

export default function AzmTrendCard({ rows }: Props) {
  const [activeWindow, setActiveWindow] = useState<HrWindow>("week");

  // today is computed client-side so it matches the user's local calendar date.
  const today = localToday();

  // Build AZM lookup: date → live-computed AZM (never read from a stored column).
  const azmByDate = new Map<string, number>();
  for (const row of rows) {
    azmByDate.set(
      row.activityDate,
      calculateActiveZoneMinutes({
        light:    row.lightMinutes,
        moderate: row.moderateMinutes,
        vigorous: row.vigorousMinutes,
        peak:     row.peakMinutes,
      }),
    );
  }

  // Week-to-date total (Monday → today inclusive).
  const weekStart = startOfWeek(today);
  let weekTotal = 0;
  for (const [date, azm] of azmByDate) {
    if (date >= weekStart && date <= today) weekTotal += azm;
  }

  // Feed raw series (only existing dates) into calculateSeriesTrend.
  // The engine fills in null for any dates without a row → preserves gap vs zero.
  const rawSeries: SeriesPoint[] = Array.from(azmByDate.entries()).map(
    ([date, value]) => ({ date, value }),
  );

  const trendResult = calculateSeriesTrend(rawSeries, activeWindow, today);
  const { points, stats } = trendResult;

  const delta     = stats.deltaVsPrev;
  const sentiment = trendSentiment("azm", delta);
  const deltaColor =
    sentiment === "improvement" ? "text-emerald-600" :
    sentiment === "decline"     ? "text-amber-600"   :
    "text-on-surface-variant";
  const deltaPrefix = delta !== null && delta > 0 ? "+" : "";

  // Pure bar layout — no framework imports inside this call.
  const azmPoints = points.map((p) => ({ date: p.date, azm: p.value }));
  const layout    = computeAzmBarLayout(azmPoints, PLOT_W, PLOT_H);

  const tickIndices = selectTrendTicks(points.length, TICK_TARGET);
  const hasData     = stats.pointsWithData > 0;

  // Average line y position in plot coordinates.
  const avgLineY =
    stats.windowAvg !== null && stats.windowAvg > 0
      ? PLOT_H - (stats.windowAvg / layout.yMax) * PLOT_H
      : null;

  // Overview: week-to-date vs weekly goal.
  const goalPct = Math.min(100, Math.round((weekTotal / AZM_WEEKLY_GOAL) * 100));
  const goalMet = weekTotal >= AZM_WEEKLY_GOAL;

  const overview = (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-display text-3xl font-bold text-on-surface">{weekTotal}</span>
      <span className="text-sm text-on-surface-variant">/ {AZM_WEEKLY_GOAL} AZM this week</span>
      {goalMet ? (
        <span className="text-xs font-semibold text-emerald-600">Goal met</span>
      ) : (
        <span className="text-xs text-on-surface-variant">{goalPct}% of weekly goal</span>
      )}
    </div>
  );

  return (
    <ExpandableCard
      title="Active Zone Minutes"
      overview={overview}
      defaultExpanded={false}
      expandLabel="Show trend"
    >
      {/* Window selector — local state, independent of ?date= URL param */}
      <div className="flex gap-2 mb-6">
        {WINDOWS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveWindow(key)}
            className={`px-4 py-1.5 text-sm font-semibold rounded-full transition-colors ${
              activeWindow === key ? PILL_ACTIVE : PILL_INACTIVE
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!hasData ? (
        <div className="flex items-center justify-center h-[190px] text-sm text-on-surface-variant">
          No AZM data for this period.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
          aria-label="Active Zone Minutes bar chart"
        >
          {/* Grid lines + y-axis labels */}
          {layout.yTicks.map((tick) => {
            const tickY = PLOT_H - (tick / layout.yMax) * PLOT_H;
            return (
              <g key={tick}>
                <line
                  x1={Y_W} x2={VB_W}
                  y1={tickY} y2={tickY}
                  stroke="#f6f4ea"
                  strokeWidth={1}
                />
                <text
                  x={Y_W - 4}
                  y={tickY}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="#848484"
                  fontSize={10}
                  fontFamily="var(--font-sans)"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Window average dashed reference line */}
          {avgLineY !== null && (
            <line
              x1={Y_W} x2={VB_W}
              y1={avgLineY} y2={avgLineY}
              stroke="#9ca3af"
              strokeWidth={1.25}
              strokeDasharray="5 4"
            />
          )}

          {/* Bars — gap bars (kind==="gap") are not rendered */}
          {layout.bars.map((bar) => {
            if (bar.kind === "gap") return null;
            return (
              <rect
                key={bar.date}
                x={Y_W + bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill={
                  bar.kind === "zero"
                    ? "var(--color-outline-variant)"
                    : "var(--color-heart-accent)"
                }
                rx={bar.kind === "data" ? 2 : 0}
              />
            );
          })}

          {/* X-axis date labels — only at tick indices to avoid crowding */}
          {points.map((p, i) => {
            if (!tickIndices.has(i)) return null;
            const centerX = Y_W + layout.bars[i].slotCenterX;
            return (
              <text
                key={p.date}
                x={centerX}
                y={PLOT_H + 14}
                textAnchor="middle"
                fill="#848484"
                fontSize={10}
                fontFamily="var(--font-sans)"
              >
                {formatDateMMDD(p.date)}
              </text>
            );
          })}
        </svg>
      )}

      {/* Stat row */}
      <div className="mt-4 pt-4 border-t border-outline-variant/50 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-on-surface-variant mb-0.5">Window avg</p>
          <p className="font-display text-lg font-bold text-on-surface">
            {stats.windowAvg !== null ? (
              <>
                {stats.windowAvg}
                <span className="text-sm font-normal text-on-surface-variant ml-0.5">AZM/day</span>
              </>
            ) : (
              <span className="text-on-surface-variant">—</span>
            )}
          </p>
        </div>

        <div>
          <p className="text-xs text-on-surface-variant mb-0.5">Range</p>
          <p className="font-display text-lg font-bold text-on-surface">
            {stats.min !== null && stats.max !== null ? (
              <>
                {stats.min}
                <span className="text-sm font-normal text-on-surface-variant mx-1">–</span>
                {stats.max}
              </>
            ) : (
              <span className="text-on-surface-variant">—</span>
            )}
          </p>
        </div>

        <div>
          <p className="text-xs text-on-surface-variant mb-0.5">Days with data</p>
          <p className="font-display text-lg font-bold text-on-surface">{stats.pointsWithData}</p>
        </div>

        <div>
          <p className="text-xs text-on-surface-variant mb-0.5">vs prior period</p>
          {delta !== null ? (
            <p className={`font-display text-lg font-bold ${deltaColor}`}>
              {deltaPrefix}{delta}
              <span className="text-sm font-normal text-on-surface-variant ml-0.5">AZM/day</span>
            </p>
          ) : (
            <p className="text-sm text-on-surface-variant">no prior data</p>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-on-surface-variant">
        <div className="flex items-center gap-1.5">
          <span
            className="block w-3 h-3 rounded-sm"
            style={{ backgroundColor: "var(--color-heart-accent)" }}
          />
          <span>Active minutes</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="block w-3 h-1 rounded-sm"
            style={{ backgroundColor: "var(--color-outline-variant)" }}
          />
          <span>Worn, no cardio</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="block w-4 border-t border-dashed"
            style={{ borderColor: "#9ca3af" }}
          />
          <span>Period avg</span>
        </div>
      </div>
    </ExpandableCard>
  );
}
