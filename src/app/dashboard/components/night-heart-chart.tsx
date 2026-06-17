"use client";

import { useMemo, useRef, useState } from "react";
import {
  buildNightHeartLayout,
  type NightHrSample,
  type NightHeartPoint,
} from "@/lib/charts/night-heart-layout";
import { buildStageGradientStops } from "@/lib/charts/night-heart-stage";
import { STAGE_COLORS, UNSTAGED_COLOR } from "@/lib/charts/stage-colors";
import type { SleepStageInterval } from "@/lib/analytics/sleep/types";
import { formatClockTime } from "@/lib/format";

interface NightHeartChartProps {
  series: NightHrSample[];
  sessionStart: string; // ISO 8601
  sessionEnd: string;   // ISO 8601
  /** Usual resting heart rate — drawn as the dashed reference line. */
  baselineRhr: number | null;
  /** Stage timeline for HR coloring. When omitted, the line renders in a single neutral color. */
  timeline?: SleepStageInterval[];
}

const PLOT_H = 160; // px height of the curve area
const AXIS_H = 26;  // px strip for clock-time labels
const GUTTER = 40;  // px left gutter for the bpm scale

const BASELINE_COLOR = "#9ca3af"; // gray-400 — usual-RHR dashed marker
const FALLBACK_HR_COLOR = "#6366f1"; // single-color fallback when no stage data

const GRAD_ID = "nhc-stage-grad"; // unique SVG gradient element ID

const STAGE_LABELS: Array<{ stage: keyof typeof STAGE_COLORS; label: string }> = [
  { stage: "deep",  label: "Deep" },
  { stage: "light", label: "Light" },
  { stage: "rem",   label: "REM" },
  { stage: "awake", label: "Awake" },
];

export default function NightHeartChart({
  series,
  sessionStart,
  sessionEnd,
  baselineRhr,
  timeline,
}: NightHeartChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<NightHeartPoint | null>(null);

  const layout = buildNightHeartLayout(series, sessionStart, sessionEnd, baselineRhr);

  // Build gradient stops from shared stage-assignment logic.
  // Empty array → no timeline or no matches → fallback to single color below.
  const gradientStops = useMemo(
    () =>
      layout && timeline && timeline.length > 0
        ? buildStageGradientStops(layout.points, timeline)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout?.points, timeline],
  );

  // Pre-build a timestamp→stage-color lookup for the hover dot + tooltip.
  const colorByTimestamp = useMemo<Map<number, string>>(() => {
    if (!layout || gradientStops.length === 0 || !timeline) return new Map();
    const map = new Map<number, string>();
    if (!timeline || timeline.length === 0) return map;
    const intervals = timeline.map((iv) => ({
      stageType: iv.stageType,
      startMs: new Date(iv.startTime).getTime(),
      endMs:   new Date(iv.endTime).getTime(),
    }));
    for (const p of layout.points) {
      let color = UNSTAGED_COLOR;
      for (const iv of intervals) {
        if (p.timestamp >= iv.startMs && p.timestamp < iv.endMs) {
          color = STAGE_COLORS[iv.stageType] ?? UNSTAGED_COLOR;
          break;
        }
      }
      map.set(p.timestamp, color);
    }
    return map;
  }, [layout?.points, timeline, gradientStops.length]);

  const hasStages = gradientStops.length > 0;
  const strokeValue = hasStages ? `url(#${GRAD_ID})` : FALLBACK_HR_COLOR;

  if (!layout) {
    return (
      <div className="flex items-center justify-center h-[160px]">
        <p className="text-sm text-on-surface-variant">No heart rate samples for this night.</p>
      </div>
    );
  }

  const path = layout.points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.xPct},${p.yFrac * 100}`)
    .join(" ");
  // Closed path for the subtle area fill (neutral when no stages, omitted when stages present).
  const areaPath = `${path} L${layout.points[layout.points.length - 1].xPct},100 L${layout.points[0].xPct},100 Z`;

  function onMouseMove(e: React.MouseEvent) {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || !layout) return;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    let nearest = layout.points[0];
    for (const p of layout.points) {
      if (Math.abs(p.xPct - xPct) < Math.abs(nearest.xPct - xPct)) nearest = p;
    }
    setHover(nearest);
  }

  const hoverColor = hover
    ? (colorByTimestamp.get(hover.timestamp) ?? FALLBACK_HR_COLOR)
    : FALLBACK_HR_COLOR;

  return (
    <div>
      <div className="flex">
        {/* bpm scale */}
        <div className="relative shrink-0" style={{ width: GUTTER, height: PLOT_H }}>
          {layout.yTicks.map((t) => (
            <span
              key={t.bpm}
              className="absolute left-0 text-[11px] text-on-surface-variant"
              style={{ top: t.yFrac * PLOT_H, transform: "translateY(-50%)" }}
            >
              {t.bpm}
            </span>
          ))}
        </div>

        {/* curve */}
        <div
          ref={plotRef}
          className="relative flex-1"
          style={{ height: PLOT_H }}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHover(null)}
        >
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {hasStages && (
              <defs>
                {/*
                  gradientUnits="userSpaceOnUse" → coordinates are in the SVG's
                  own coordinate system (0-100 x-range from viewBox). Since xPct
                  is already expressed in that same 0-100 space, gradient stop
                  offsets align exactly to data points with no margin compensation.
                */}
                <linearGradient
                  id={GRAD_ID}
                  x1="0"
                  y1="0"
                  x2="100"
                  y2="0"
                  gradientUnits="userSpaceOnUse"
                >
                  {gradientStops.map((s, i) => (
                    <stop
                      key={i}
                      offset={`${s.offsetPct}%`}
                      stopColor={s.color}
                    />
                  ))}
                </linearGradient>
              </defs>
            )}

            {/* horizontal gridlines */}
            {layout.yTicks.map((t) => (
              <line
                key={t.bpm}
                x1="0" x2="100"
                y1={t.yFrac * 100} y2={t.yFrac * 100}
                stroke="#ebe9e4"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* area fill — omitted when stage coloring is active (muddies the stage palette);
                neutral grey otherwise */}
            {!hasStages && (
              <path d={areaPath} fill="#9ca3af" fillOpacity={0.06} stroke="none" />
            )}

            {/* overnight heart rate curve */}
            <path
              d={path}
              fill="none"
              stroke={strokeValue}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* usual resting HR — dashed reference (always neutral grey) */}
            {layout.baseline && (
              <line
                x1="0" x2="100"
                y1={layout.baseline.yFrac * 100} y2={layout.baseline.yFrac * 100}
                stroke={BASELINE_COLOR}
                strokeWidth={1.25}
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* baseline tag */}
          {layout.baseline && (
            <span
              className="absolute right-0 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant bg-white/80 px-1 rounded-sm"
              style={{
                top: layout.baseline.yFrac * PLOT_H,
                transform: "translateY(calc(-100% - 2px))",
              }}
            >
              usual {layout.baseline.bpm} bpm
            </span>
          )}

          {/* hover marker + tooltip */}
          {hover && (
            <>
              <div
                className="absolute w-2 h-2 rounded-full border-2 border-white"
                style={{
                  left: `${hover.xPct}%`,
                  top: hover.yFrac * PLOT_H,
                  transform: "translate(-50%, -50%)",
                  backgroundColor: hoverColor,
                }}
              />
              <div
                className="absolute pointer-events-none whitespace-nowrap rounded-lg px-3 py-2 text-xs shadow-lg z-10"
                style={{
                  left: `${hover.xPct}%`,
                  top: hover.yFrac * PLOT_H,
                  transform: "translate(-50%, calc(-100% - 10px))",
                  backgroundColor: "#1c1c16",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <span style={{ color: hoverColor, fontWeight: 700 }}>{hover.bpm} bpm</span>
                <span style={{ color: "#e5e2d9", marginLeft: 8 }}>{formatClockTime(hover.timestamp)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* time axis */}
      <div className="relative" style={{ height: AXIS_H, marginLeft: GUTTER }}>
        {layout.ticks.map((tick) => (
          <span
            key={tick.timestamp}
            className="absolute top-2 text-[11px] text-on-surface-variant"
            style={
              tick.anchor === "start"
                ? { left: 0 }
                : tick.anchor === "end"
                ? { right: 0 }
                : { left: `${tick.xPct}%`, transform: "translateX(-50%)" }
            }
          >
            {formatClockTime(tick.timestamp)}
          </span>
        ))}
      </div>

      {/* stage legend */}
      {hasStages && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
          {STAGE_LABELS.map(({ stage, label }) => (
            <span key={stage} className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: STAGE_COLORS[stage] }}
              />
              {label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: UNSTAGED_COLOR }}
            />
            Unstaged
          </span>
        </div>
      )}

      {/* baseline summary */}
      {layout.baseline && (
        <p className="text-xs text-on-surface-variant mt-3 pt-3 border-t border-outline-variant/50">
          Range {layout.minBpm}–{layout.maxBpm} bpm.{" "}
          {layout.timeBelowBaselinePct > 0
            ? <>Spent <strong className="text-on-surface">{layout.timeBelowBaselinePct}%</strong> of the night below your usual resting rate.</>
            : <>Stayed above your usual resting rate all night.</>}
        </p>
      )}
    </div>
  );
}
