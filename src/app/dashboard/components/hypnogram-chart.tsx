"use client";

import { useRef, useState } from "react";
import type { RestlessEvent, SleepStageInterval } from "@/lib/analytics/sleep";
import {
  buildHypnogramLayout,
  LANES,
  LANE_INDEX,
  type HypnogramSegment,
  type RestlessMarker,
} from "@/lib/charts/hypnogram-layout";
import { formatClockTime, formatDurationMs } from "@/lib/format";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HypnogramChartProps {
  /** Raw stage intervals from the DB, sorted ascending by startTime. */
  timeline: SleepStageInterval[];
  sessionStart: string; // ISO 8601
  sessionEnd: string;   // ISO 8601
  /** Pre-computed restless stirs from assemble.ts (HR-derived or empty). */
  restlessEvents?: RestlessEvent[];
  /** How the restless events were detected — drives label and tooltip copy. */
  restlessnessSource?: "none" | "hr-estimated";
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

/** Deep blocks at/above the 30m anchor threshold get a contrasting highlight. */
const CONSOLIDATED_DEEP_COLOR = "#0d9488"; // teal-600
const CONSOLIDATED_DEEP_MIN_MS = 30 * 60000;

/** Brief mid-night stirs are flagged with a rose diamond on the Awake lane. */
const RESTLESS_COLOR = "#f43f5e"; // rose-500
const RESTLESS_D = 11; // diamond bounding size, px

// Vertical geometry (px). Each lane row = label line + segment track.
const ROW_H   = 64; // total height of one lane row
const LABEL_Y = 16; // baseline of the lane label within its row
const TRACK_Y = 42; // vertical center of the segment track within its row
const SEG_H   = 14; // height of a stage segment pill
const AXIS_H  = 30; // bottom strip for clock-time labels
const CHART_H = ROW_H * LANES.length + AXIS_H;
const SLIGHT_RX = 2.5; // corner radius for mid-night segments

const laneCenter = (laneIdx: number) => laneIdx * ROW_H + TRACK_Y;

function segmentFill(seg: HypnogramSegment): string {
  const { interval } = seg;
  if (interval.stageType === "deep" && interval.durationMs >= CONSOLIDATED_DEEP_MIN_MS) {
    return CONSOLIDATED_DEEP_COLOR;
  }
  return STAGE_COLORS[interval.stageType];
}

// ---------------------------------------------------------------------------
// Tooltip state
// ---------------------------------------------------------------------------

interface TooltipState {
  x: number; // px within chart container
  y: number; // px within chart container
  title: string;      // "Deep", "Restless", … (capitalized on render)
  titleColor: string;
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
  restlessEvents = [],
  restlessnessSource = "none",
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

  const layout = buildHypnogramLayout(timeline, sessionStart, sessionEnd, restlessEvents);

  function showTooltip(e: React.MouseEvent, seg: HypnogramSegment) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { interval } = seg;
    setTooltip({
      x: e.clientX - rect.left,
      y: laneCenter(seg.laneIndex) - SEG_H / 2,
      title: interval.stageType,
      titleColor: STAGE_COLORS[interval.stageType],
      rangeLabel: `${formatClockTime(interval.startTime)} – ${formatClockTime(interval.endTime)}`,
      durationLabel: formatDurationMs(interval.durationMs),
    });
  }

  function showRestlessTooltip(e: React.MouseEvent, m: RestlessMarker) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left,
      y: laneCenter(LANE_INDEX.awake) - SEG_H / 2,
      title: restlessnessSource === "hr-estimated" ? "Restless (est.)" : "Restless",
      titleColor: RESTLESS_COLOR,
      rangeLabel: formatClockTime(m.startTimestamp),
      durationLabel: formatDurationMs(m.durationMs),
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
      {/* Chart — Fitbit-style lane timeline. All geometry comes from the    */}
      {/* pure layout module; SVG x-coordinates are percentages so the chart */}
      {/* is fluid-width with no resize observer.                            */}
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
                  {" · "}{formatDurationMs(layout.stageTotalsMs[stage])}
                </tspan>
                {stage === "awake" && layout.restlessMarkers.length > 0 && (
                  <tspan fill={RESTLESS_COLOR} fontWeight={600}>
                    {" · "}{restlessnessSource === "hr-estimated" ? "~" : ""}{layout.restlessMarkers.length} restless
                  </tspan>
                )}
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
          {layout.connectors.map((c, k) => (
            <line
              key={`c-${k}`}
              x1={`${c.xPct}%`}
              x2={`${c.xPct}%`}
              y1={laneCenter(c.fromLane)}
              y2={laneCenter(c.toLane)}
              stroke="#c9c5bc"
              strokeWidth={1}
              strokeDasharray="1.5 3.5"
            />
          ))}

          {/* Stage segments — slight rounding through the night; the first and
              last segments get a fully rounded outer edge (sleep onset / wake)
              while their inner edge keeps the slight radius. SVG rx rounds all
              corners, so the boundary segments layer a full-pill rect under a
              slight-radius rect covering the inner half; group opacity keeps
              the hover state seamless across the overlap. */}
          {layout.segments.map((seg, k) => {
            const { xPct: x, widthPct: w, roundLeft, roundRight } = seg;
            const common = {
              y: laneCenter(seg.laneIndex) - SEG_H / 2,
              height: SEG_H,
              fill: segmentFill(seg),
            };

            const shape =
              roundLeft && roundRight ? (
                <rect x={`${x}%`} width={`${w}%`} rx={SEG_H / 2} {...common} />
              ) : roundLeft ? (
                <>
                  <rect x={`${x}%`} width={`${w}%`} rx={SEG_H / 2} {...common} />
                  <rect x={`${x + w / 2}%`} width={`${w / 2}%`} rx={SLIGHT_RX} {...common} />
                </>
              ) : roundRight ? (
                <>
                  <rect x={`${x}%`} width={`${w}%`} rx={SEG_H / 2} {...common} />
                  <rect x={`${x}%`} width={`${w / 2}%`} rx={SLIGHT_RX} {...common} />
                </>
              ) : (
                <rect x={`${x}%`} width={`${w}%`} rx={SLIGHT_RX} {...common} />
              );

            return (
              <g
                key={`s-${k}`}
                className="cursor-pointer transition-opacity hover:opacity-80"
                onMouseEnter={(e) => showTooltip(e, seg)}
                onMouseLeave={() => setTooltip(null)}
              >
                {shape}
              </g>
            );
          })}

          {/* Restless markers — brief (<5m) mid-night stirs, as rose diamonds
              centered on the Awake lane. The wrapping g shifts left by half the
              diamond so the x-percentage lands on its center; the rect rotates
              45° around its own box center (transform-box: fill-box). */}
          {layout.restlessMarkers.map((m, k) => (
            <g
              key={`r-${k}`}
              transform={`translate(${-RESTLESS_D / 2}, 0)`}
              className="cursor-pointer"
              onMouseEnter={(e) => showRestlessTooltip(e, m)}
              onMouseLeave={() => setTooltip(null)}
            >
              <rect
                x={`${m.xPct}%`}
                y={laneCenter(LANE_INDEX.awake) - RESTLESS_D / 2}
                width={RESTLESS_D}
                height={RESTLESS_D}
                fill={RESTLESS_COLOR}
                stroke="#ffffff"
                strokeWidth={1.5}
                style={{ transformBox: "fill-box", transformOrigin: "center", transform: "rotate(45deg)" }}
              />
            </g>
          ))}

          {/* Time axis */}
          {layout.ticks.map((tick) => (
            <text
              key={tick.timestamp}
              x={`${tick.xPct}%`}
              y={ROW_H * LANES.length + 18}
              fontSize={11}
              fill="#848484"
              fontFamily="var(--font-sans)"
              textAnchor={tick.anchor}
            >
              {formatClockTime(tick.timestamp)}
            </text>
          ))}
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
                color: tooltip.titleColor,
                fontWeight: 700,
                fontFamily: "var(--font-display)",
                margin: 0,
                textTransform: "capitalize",
                fontSize: 13,
                letterSpacing: "0.01em",
              }}
            >
              {tooltip.title}
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
