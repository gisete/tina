"use client";

import { useRef, useState } from "react";
import {
  buildNightHeartLayout,
  type NightHrSample,
  type NightHeartPoint,
} from "@/lib/charts/night-heart-layout";
import { formatClockTime } from "@/lib/format";

interface NightHeartChartProps {
  series: NightHrSample[];
  sessionStart: string; // ISO 8601
  sessionEnd: string;   // ISO 8601
  /** Usual resting heart rate — drawn as the dashed reference line. */
  baselineRhr: number | null;
}

const PLOT_H = 160; // px height of the curve area
const AXIS_H = 26;  // px strip for clock-time labels
const GUTTER = 40;  // px left gutter for the bpm scale

const HR_COLOR = "#e11d48";       // rose-600 — the heart rate curve
const BASELINE_COLOR = "#9ca3af"; // gray-400 — usual-RHR dashed marker

export default function NightHeartChart({
  series,
  sessionStart,
  sessionEnd,
  baselineRhr,
}: NightHeartChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<NightHeartPoint | null>(null);

  const layout = buildNightHeartLayout(series, sessionStart, sessionEnd, baselineRhr);

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
  // Closed variant for the soft fill under the curve.
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

            {/* soft fill under the curve */}
            <path d={areaPath} fill={HR_COLOR} fillOpacity={0.07} stroke="none" />

            {/* heart rate curve */}
            <path
              d={path}
              fill="none"
              stroke={HR_COLOR}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* usual resting HR — dashed reference */}
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
                  backgroundColor: HR_COLOR,
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
                <span style={{ color: HR_COLOR, fontWeight: 700 }}>{hover.bpm} bpm</span>
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

      {/* dip summary */}
      {layout.baseline && (
        <p className="text-xs text-on-surface-variant mt-3 pt-3 border-t border-outline-variant/50">
          Range {layout.minBpm}–{layout.maxBpm} bpm.{" "}
          {layout.dipsBelowBaseline > 0
            ? <>Dropped below your usual resting rate <strong className="text-on-surface">{layout.dipsBelowBaseline} time{layout.dipsBelowBaseline === 1 ? "" : "s"}</strong> — deep, restorative stretches.</>
            : <>Stayed above your usual resting rate all night.</>}
        </p>
      )}
    </div>
  );
}
