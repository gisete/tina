"use client";

import { useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  buildRecoveryBalanceGeometry,
  type ZPoint,
} from "@/lib/charts/recovery-balance";
import {
  standardizeRecoverySeries,
  trendSentiment,
  METRIC_DIRECTION,
  WINDOW_DAYS,
  type DailyHrSummary,
  type HrWindow,
  type HrMetric,
} from "@/lib/analytics/hr-trends";
import { addDays, localToday } from "@/lib/dates";
import { formatDateMMDD } from "@/lib/format";
import ExpandableCard from "../../components/expandable-card";

// ---------------------------------------------------------------------------

const SEARCH_PARAM = "balanceWindow";
const PLOT_H   = 200;
const GUTTER_W = 40;
const AXIS_H   = 24;

const WINDOWS: Array<{ key: HrWindow; label: string }> = [
  { key: "week",  label: "7 days"  },
  { key: "month", label: "30 days" },
  { key: "90d",   label: "90 days" },
];

const PILL_ACTIVE   = "bg-on-surface text-white";
const PILL_INACTIVE = "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

const RHR_COLOR = "var(--color-heart-accent)";
const HRV_COLOR = "var(--color-hrv-accent)";

function isValidWindow(s: string | null): s is HrWindow {
  return s === "week" || s === "month" || s === "90d";
}

function directionHint(metric: HrMetric): string {
  return METRIC_DIRECTION[metric] > 0 ? "higher = better" : "higher = worse";
}

function segToPath(seg: ZPoint[]): string {
  return seg
    .map((p, i) => `${i === 0 ? "M" : "L"}${(p.xFrac * 100).toFixed(2)} ${(p.yFrac * 100).toFixed(2)}`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Overview line — shows the most recent night's z-score in plain language.
// Sentiment is derived from METRIC_DIRECTION via trendSentiment; no hardcoding.

function RecoveryOverviewLine({
  label,
  z,
  metric,
  baselineReady,
}: {
  label: string;
  z: number | null;
  metric: HrMetric;
  baselineReady: boolean;
}) {
  if (!baselineReady) {
    return (
      <div className="flex items-baseline gap-2 text-sm">
        <span className="text-on-surface-variant w-20 shrink-0">{label}</span>
        <span className="text-on-surface-variant italic">not enough history yet</span>
      </div>
    );
  }
  if (z === null) {
    return (
      <div className="flex items-baseline gap-2 text-sm">
        <span className="text-on-surface-variant w-20 shrink-0">{label}</span>
        <span className="text-on-surface-variant">—</span>
      </div>
    );
  }
  const sentiment   = trendSentiment(metric, z);
  const valueColor  =
    sentiment === "improvement" ? "text-emerald-600" :
    sentiment === "decline"     ? "text-amber-600" :
    "text-on-surface";
  const direction = z > 0 ? "above" : "below";
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-on-surface-variant w-20 shrink-0">{label}</span>
      <span className={`font-semibold ${valueColor}`}>
        {Math.abs(z).toFixed(1)} {direction} your normal
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ring markers — HTML divs (avoids viewBox distortion inside preserveAspectRatio="none" SVG).

function RingMarker({ m, color, index }: { m: ZPoint; color: string; index: number }) {
  return (
    <div
      key={index}
      className="absolute rounded-full pointer-events-none"
      style={{
        left:            `${m.xFrac * 100}%`,
        top:             m.yFrac * PLOT_H,
        transform:       "translate(-50%, -50%)",
        width:           7,
        height:          7,
        backgroundColor: "#ffffff",
        borderWidth:     2,
        borderStyle:     "solid",
        borderColor:     color,
      }}
    />
  );
}

// ---------------------------------------------------------------------------

interface Props {
  summaries: DailyHrSummary[];
}

export default function RecoveryBalanceChart({ summaries }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const plotRef      = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const rawWindow    = searchParams.get(SEARCH_PARAM);
  const activeWindow: HrWindow = isValidWindow(rawWindow) ? rawWindow : "week";

  const setWindow = (w: HrWindow) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(SEARCH_PARAM, w);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const today       = localToday();
  const len         = WINDOW_DAYS[activeWindow];
  const windowStart = addDays(today, -(len - 1));

  const dates = Array.from({ length: len }, (_, i) => addDays(windowStart, i));

  // Baseline always computed over ALL provided summaries (≥90 days from page).
  const { rhr: rhrSeries, hrv: hrvSeries } = standardizeRecoverySeries(
    summaries,
    windowStart,
    today,
  );

  const geo = buildRecoveryBalanceGeometry(rhrSeries.points, hrvSeries.points);

  const bothAbsent = !rhrSeries.baselineReady && !hrvSeries.baselineReady;

  const span    = geo.yMax - geo.yMin;
  const toYFrac = (z: number) => (geo.yMax - z) / span;

  // -------------------------------------------------------------------------
  // Overview: most recent night's z-score per metric.
  // points[len - 1] is always "today" regardless of window length,
  // because windowEnd is always localToday() and points are left-padded.
  const lastRhrZ = rhrSeries.points[len - 1] ?? null;
  const lastHrvZ = hrvSeries.points[len - 1] ?? null;

  const overview = (
    <div className="space-y-1.5">
      <RecoveryOverviewLine
        label="Resting HR"
        z={lastRhrZ}
        metric="rhr"
        baselineReady={rhrSeries.baselineReady}
      />
      <RecoveryOverviewLine
        label="HRV"
        z={lastHrvZ}
        metric="hrv"
        baselineReady={hrvSeries.baselineReady}
      />
    </div>
  );

  // -------------------------------------------------------------------------
  // Hover

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || len === 0) return;
    const xFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(xFrac * (len - 1)));
  };

  const hoverX    = hoverIdx !== null ? geo.xFracs[hoverIdx] : null;
  const hoverRhrZ = hoverIdx !== null ? (rhrSeries.points[hoverIdx] ?? null) : null;
  const hoverHrvZ = hoverIdx !== null ? (hrvSeries.points[hoverIdx] ?? null) : null;

  const tooltipTransform =
    hoverX === null       ? undefined :
    hoverX * 100 < 20     ? "translate(0, 0)" :
    hoverX * 100 > 80     ? "translate(-100%, 0)" :
                            "translate(-50%, 0)";

  // -------------------------------------------------------------------------

  return (
    <ExpandableCard
      title="Recovery vs Normal"
      overview={overview}
      defaultExpanded={false}
      expandLabel="Show chart"
    >
      {/* Caption */}
      <p className="text-sm text-on-surface-variant mb-6">
        Each night vs your own 90-day normal — higher RHR = more strain, higher HRV = better recovery.
      </p>

      {/* Window control */}
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

      {/* Legend */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
        {(["rhr", "hrv"] as const).map((metric) => {
          const color  = metric === "rhr" ? RHR_COLOR : HRV_COLOR;
          const label  = metric === "rhr" ? "Resting HR" : "HRV";
          const series = metric === "rhr" ? rhrSeries   : hrvSeries;
          return (
            <div key={metric} className="flex items-center gap-2">
              <div className="w-5 rounded-full" style={{ backgroundColor: color, height: "2px" }} />
              <span className="text-xs text-on-surface-variant">
                {label}
                <span className="text-on-surface-variant/60 ml-1">· {directionHint(metric)}</span>
              </span>
              {!series.baselineReady && (
                <span className="text-xs text-amber-600 italic ml-1">
                  — need more history for a baseline
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Chart */}
      {bothAbsent ? (
        <div
          className="flex items-center justify-center text-sm text-on-surface-variant"
          style={{ height: PLOT_H }}
        >
          Not enough history for a baseline yet — need at least 14 nights.
        </div>
      ) : (
        <>
          <div className="flex">
            {/* Y-axis: z-score labels */}
            <div className="relative shrink-0" style={{ width: GUTTER_W, height: PLOT_H }}>
              {geo.yTicks.map((t) => (
                <span
                  key={t.z}
                  className="absolute right-2 text-[11px] text-on-surface-variant"
                  style={{
                    top:       t.yFrac * PLOT_H,
                    transform: "translateY(-50%)",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {t.z > 0 ? `+${t.z}` : `${t.z}`}
                </span>
              ))}
            </div>

            {/* Plot area */}
            <div
              ref={plotRef}
              className="relative flex-1 cursor-crosshair"
              style={{ height: PLOT_H }}
              onMouseMove={onMouseMove}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* SVG: gridlines, zero reference line, hover cursor, data lines */}
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {/* Horizontal gridlines */}
                {geo.yTicks.map((t) => (
                  <line
                    key={t.z}
                    x1="0" x2="100"
                    y1={t.yFrac * 100} y2={t.yFrac * 100}
                    stroke="#f6f4ea"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {/* Zero reference line — styled like window-average reference line */}
                <line
                  x1="0" x2="100"
                  y1={geo.zeroYFrac * 100} y2={geo.zeroYFrac * 100}
                  stroke="#9ca3af"
                  strokeDasharray="5 4"
                  strokeWidth={1.25}
                  vectorEffect="non-scaling-stroke"
                />

                {/* Hover cursor line */}
                {hoverX !== null && (
                  <line
                    x1={hoverX * 100} y1="0"
                    x2={hoverX * 100} y2="100"
                    stroke="#e5e2d9"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )}

                {/* RHR line */}
                {rhrSeries.baselineReady && geo.rhrSegments.map((seg, si) => (
                  <path
                    key={si}
                    d={segToPath(seg)}
                    fill="none"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    style={{ stroke: RHR_COLOR }}
                  />
                ))}

                {/* HRV line */}
                {hrvSeries.baselineReady && geo.hrvSegments.map((seg, si) => (
                  <path
                    key={si}
                    d={segToPath(seg)}
                    fill="none"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    style={{ stroke: HRV_COLOR }}
                  />
                ))}
              </svg>

              {/* "your normal" label above the zero line, right-aligned */}
              <span
                className="absolute right-0 text-[11px] text-on-surface-variant pointer-events-none"
                style={{
                  top:       geo.zeroYFrac * PLOT_H,
                  transform: "translateY(calc(-100% - 2px))",
                  fontFamily: "var(--font-sans)",
                }}
              >
                your normal
              </span>

              {/* Ring markers — 7-day and 30-day windows only */}
              {activeWindow !== "90d" && rhrSeries.baselineReady &&
                geo.rhrMarkers.map((m, i) => (
                  <RingMarker key={i} m={m} color={RHR_COLOR} index={i} />
                ))}
              {activeWindow !== "90d" && hrvSeries.baselineReady &&
                geo.hrvMarkers.map((m, i) => (
                  <RingMarker key={i} m={m} color={HRV_COLOR} index={i} />
                ))}

              {/* Hover active dots */}
              {hoverX !== null && rhrSeries.baselineReady && hoverRhrZ !== null && (
                <div
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    left:            `${hoverX * 100}%`,
                    top:             toYFrac(hoverRhrZ) * PLOT_H,
                    transform:       "translate(-50%, -50%)",
                    width:           10,
                    height:          10,
                    backgroundColor: RHR_COLOR,
                    borderWidth:     2,
                    borderStyle:     "solid",
                    borderColor:     "#ffffff",
                  }}
                />
              )}
              {hoverX !== null && hrvSeries.baselineReady && hoverHrvZ !== null && (
                <div
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    left:            `${hoverX * 100}%`,
                    top:             toYFrac(hoverHrvZ) * PLOT_H,
                    transform:       "translate(-50%, -50%)",
                    width:           10,
                    height:          10,
                    backgroundColor: HRV_COLOR,
                    borderWidth:     2,
                    borderStyle:     "solid",
                    borderColor:     "#ffffff",
                  }}
                />
              )}

              {/* Hover tooltip */}
              {hoverX !== null && hoverIdx !== null &&
               (hoverRhrZ !== null || hoverHrvZ !== null) && (
                <div
                  className="absolute pointer-events-none rounded-lg px-3 py-2 text-xs shadow-lg z-10 whitespace-nowrap"
                  style={{
                    left:            `${hoverX * 100}%`,
                    top:             8,
                    transform:       tooltipTransform,
                    backgroundColor: "#1c1c16",
                    fontFamily:      "var(--font-sans)",
                  }}
                >
                  <div
                    className="font-bold mb-1"
                    style={{ color: "#ffffff", fontFamily: "var(--font-display)" }}
                  >
                    {formatDateMMDD(dates[hoverIdx])}
                  </div>
                  {rhrSeries.baselineReady && hoverRhrZ !== null && (
                    <div style={{ color: "#e5e2d9" }}>
                      Resting HR {hoverRhrZ > 0 ? "+" : ""}{hoverRhrZ.toFixed(2)} σ
                    </div>
                  )}
                  {hrvSeries.baselineReady && hoverHrvZ !== null && (
                    <div style={{ color: "#e5e2d9" }}>
                      HRV {hoverHrvZ > 0 ? "+" : ""}{hoverHrvZ.toFixed(2)} σ
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* X-axis: date labels */}
          <div className="relative" style={{ height: AXIS_H, marginLeft: GUTTER_W }}>
            {dates.map((d, i) => {
              if (!geo.xTickIndices.has(i)) return null;
              const isFirst = i === 0;
              const isLast  = i === dates.length - 1;
              const posStyle = isFirst
                ? { left: 0 }
                : isLast
                ? { right: 0 }
                : { left: `${(geo.xFracs[i] * 100).toFixed(2)}%`, transform: "translateX(-50%)" };
              return (
                <span
                  key={d}
                  className="absolute text-[12px] text-on-surface-variant"
                  style={{ top: 8, ...posStyle, fontFamily: "var(--font-sans)" }}
                >
                  {formatDateMMDD(d)}
                </span>
              );
            })}
          </div>
        </>
      )}
    </ExpandableCard>
  );
}
