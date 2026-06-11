"use client";

import { useRef, useState } from "react";
import type { SleepStageInterval } from "@/lib/analytics/sleep";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HypnogramChartProps {
  /** Raw stage intervals from the DB, sorted ascending by startTime. */
  timeline: SleepStageInterval[];
  sessionStart: string; // ISO 8601
  sessionEnd: string;   // ISO 8601
  /**
   * When true the component renders without its outer card wrapper and internal
   * header row so a parent container can provide its own card shell and title.
   */
  bare?: boolean;
}

// ---------------------------------------------------------------------------
// Stage colour palette (Fitbit-inspired)
// ---------------------------------------------------------------------------

const STAGE_COLORS: Record<string, string> = {
  deep:  "#1e1b4b", // indigo-950  — deep midnight navy
  light: "#6366f1", // indigo-500  — periwinkle
  rem:   "#8b5cf6", // violet-500  — lavender purple
  awake: "#d97706", // amber-600   — soft amber gold
};

// ---------------------------------------------------------------------------
// Lane layout — Fitbit ordering: Awake on top, Deep at the bottom
// ---------------------------------------------------------------------------

type StageType = SleepStageInterval["stageType"];

const LANES: Array<{ stage: StageType; label: string }> = [
  { stage: "awake", label: "Awake" },
  { stage: "rem",   label: "REM" },
  { stage: "light", label: "Light" },
  { stage: "deep",  label: "Deep" },
];

const LANE_INDEX: Record<StageType, number> = {
  awake: 0,
  rem:   1,
  light: 2,
  deep:  3,
};

// Vertical geometry (px). Each lane row = label line + segment track.
const ROW_H   = 64; // total height of one lane row
const LABEL_Y = 16; // baseline of the lane label within its row
const TRACK_Y = 42; // vertical center of the segment track within its row
const SEG_H   = 14; // height of a stage segment pill
const AXIS_H  = 30; // bottom strip for clock-time labels
const CHART_H = ROW_H * LANES.length + AXIS_H;

const laneCenter = (laneIdx: number) => laneIdx * ROW_H + TRACK_Y;

// Segments narrower than this (% of session width) are clamped up so brief
// interruptions stay visible as thin ticks instead of vanishing entirely.
const MIN_SEG_PCT = 0.45;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---------------------------------------------------------------------------
// Tooltip state
// ---------------------------------------------------------------------------

interface TooltipState {
  x: number; // px within chart container
  y: number; // px within chart container
  stage: StageType;
  rangeLabel: string;
  durationLabel: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HypnogramChart({
  timeline,
  sessionStart,
  sessionEnd,
  bare = false,
}: HypnogramChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  if (timeline.length === 0) {
    return (
      <div className={bare ? "flex items-center justify-center h-[280px]" : "bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex items-center justify-center h-[280px]"}>
        <p className="text-sm text-on-surface-variant">No stage data for this session.</p>
      </div>
    );
  }

  const startTs = new Date(sessionStart).getTime();
  const endTs   = new Date(sessionEnd).getTime();
  const spanMs  = Math.max(endTs - startTs, 1);

  const pct = (ts: number) => ((ts - startTs) / spanMs) * 100;

  const intervals = [...timeline].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  // Per-stage totals for the lane labels — "Awake · 1h 9m"
  const stageTotals: Record<StageType, number> = { awake: 0, rem: 0, light: 0, deep: 0 };
  for (const iv of intervals) stageTotals[iv.stageType] += iv.durationMs;

  // X-axis ticks: session start + whole-hour marks + session end. Inner ticks
  // near the edges are dropped so they don't collide with the boundary labels.
  const spanHours = spanMs / 3_600_000;
  const stepHours = Math.max(1, Math.ceil(spanHours / 4));
  const innerTicks: number[] = [];
  const cursor = new Date(startTs);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1);
  for (let t = cursor.getTime(); t < endTs; t += stepHours * 3_600_000) {
    const p = pct(t);
    if (p > 8 && p < 92) innerTicks.push(t);
  }

  function showTooltip(e: React.MouseEvent, iv: SleepStageInterval, laneIdx: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left,
      y: laneCenter(laneIdx) - SEG_H / 2,
      stage: iv.stageType,
      rangeLabel: `${formatClock(new Date(iv.startTime).getTime())} – ${formatClock(new Date(iv.endTime).getTime())}`,
      durationLabel: formatDuration(iv.durationMs),
    });
  }

  const sessionDate = new Date(sessionStart).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const inner = (
    <>
      {/* ----------------------------------------------------------------- */}
      {/* Header — hidden when bare; the parent container owns the title.   */}
      {/* ----------------------------------------------------------------- */}
      {!bare && (
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="font-display text-xl font-semibold text-on-surface tracking-tight">
              Last Night
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Stage transitions · hypnogram view
            </p>
          </div>
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            {sessionDate}
          </span>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Chart — Fitbit-style lane timeline. SVG rects use percentage X     */}
      {/* coordinates so the chart is fluid-width with no resize observer.   */}
      {/* ----------------------------------------------------------------- */}
      <div ref={containerRef} className="relative w-full" onMouseLeave={() => setTooltip(null)}>
        <svg width="100%" height={CHART_H} className="block select-none">

          {/* Lane labels + background rails */}
          {LANES.map(({ stage, label }, i) => (
            <g key={stage}>
              <text
                x="0"
                y={i * ROW_H + LABEL_Y}
                fontSize={13}
                fontWeight={600}
                fill="#404040"
                fontFamily="var(--font-sans)"
              >
                {label}
                <tspan fill="#848484" fontWeight={500}>
                  {" · "}{formatDuration(stageTotals[stage])}
                </tspan>
              </text>
              <line
                x1="0%"
                x2="100%"
                y1={laneCenter(i)}
                y2={laneCenter(i)}
                stroke="#e8e6e1"
                strokeWidth={3}
                strokeLinecap="round"
              />
            </g>
          ))}

          {/* Dashed transition connectors — drawn under the segments */}
          {intervals.map((iv, k) => {
            const next = intervals[k + 1];
            if (!next || next.stageType === iv.stageType) return null;
            const x = `${pct(new Date(next.startTime).getTime())}%`;
            return (
              <line
                key={`c-${k}`}
                x1={x}
                x2={x}
                y1={laneCenter(LANE_INDEX[iv.stageType])}
                y2={laneCenter(LANE_INDEX[next.stageType])}
                stroke="#c9c5bc"
                strokeWidth={1}
                strokeDasharray="1.5 3.5"
              />
            );
          })}

          {/* Stage segments — slight rounding through the night; the first and
              last segments get a fully rounded outer edge (sleep onset / wake)
              while their inner edge keeps the slight radius. SVG rx rounds all
              corners, so the boundary segments layer a full-pill rect under a
              slight-radius rect covering the inner half; group opacity keeps
              the hover state seamless across the overlap. */}
          {intervals.map((iv, k) => {
            const laneIdx = LANE_INDEX[iv.stageType];
            const x = pct(new Date(iv.startTime).getTime());
            const w = Math.min(
              Math.max(pct(new Date(iv.endTime).getTime()) - x, MIN_SEG_PCT),
              100 - x
            );
            const isFirst = k === 0;
            const isLast = k === intervals.length - 1;

            const common = {
              y: laneCenter(laneIdx) - SEG_H / 2,
              height: SEG_H,
              fill: STAGE_COLORS[iv.stageType],
            };

            const shape =
              isFirst && isLast ? (
                <rect x={`${x}%`} width={`${w}%`} rx={SEG_H / 2} {...common} />
              ) : isFirst ? (
                <>
                  <rect x={`${x}%`} width={`${w}%`} rx={SEG_H / 2} {...common} />
                  <rect x={`${x + w / 2}%`} width={`${w / 2}%`} rx={2.5} {...common} />
                </>
              ) : isLast ? (
                <>
                  <rect x={`${x}%`} width={`${w}%`} rx={SEG_H / 2} {...common} />
                  <rect x={`${x}%`} width={`${w / 2}%`} rx={2.5} {...common} />
                </>
              ) : (
                <rect x={`${x}%`} width={`${w}%`} rx={2.5} {...common} />
              );

            return (
              <g
                key={`s-${k}`}
                className="cursor-pointer transition-opacity hover:opacity-80"
                onMouseEnter={(e) => showTooltip(e, iv, laneIdx)}
                onMouseLeave={() => setTooltip(null)}
              >
                {shape}
              </g>
            );
          })}

          {/* Time axis */}
          <text
            x="0"
            y={ROW_H * LANES.length + 18}
            fontSize={11}
            fill="#848484"
            fontFamily="var(--font-sans)"
            textAnchor="start"
          >
            {formatClock(startTs)}
          </text>
          {innerTicks.map((t) => (
            <text
              key={t}
              x={`${pct(t)}%`}
              y={ROW_H * LANES.length + 18}
              fontSize={11}
              fill="#848484"
              fontFamily="var(--font-sans)"
              textAnchor="middle"
            >
              {formatClock(t)}
            </text>
          ))}
          <text
            x="100%"
            y={ROW_H * LANES.length + 18}
            fontSize={11}
            fill="#848484"
            fontFamily="var(--font-sans)"
            textAnchor="end"
          >
            {formatClock(endTs)}
          </text>
        </svg>

        {/* Hover tooltip */}
        {tooltip && (
          <div
            style={{
              position: "absolute",
              left: tooltip.x,
              top: tooltip.y,
              transform: "translate(-50%, calc(-100% - 10px))",
              pointerEvents: "none",
              backgroundColor: "#1c1c16",
              borderRadius: "8px",
              padding: "8px 12px",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              lineHeight: 1.6,
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              whiteSpace: "nowrap",
              zIndex: 10,
            }}
          >
            <p
              style={{
                color: STAGE_COLORS[tooltip.stage],
                fontWeight: 700,
                fontFamily: "var(--font-display)",
                margin: 0,
                textTransform: "capitalize",
                fontSize: 13,
                letterSpacing: "0.01em",
              }}
            >
              {tooltip.stage}
              <span style={{ color: "#a8a496", fontWeight: 500, marginLeft: 6 }}>
                {tooltip.durationLabel}
              </span>
            </p>
            <p style={{ color: "#e5e2d9", margin: "3px 0 0" }}>{tooltip.rangeLabel}</p>
          </div>
        )}
      </div>
    </>
  );

  if (bare) return inner;

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding">
      {inner}
    </div>
  );
}
