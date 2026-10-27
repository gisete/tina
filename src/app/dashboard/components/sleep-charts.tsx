"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
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
import {
  calculateSeriesTrend,
  type HrWindow,
} from "@/lib/analytics/hr-trends";
import { localToday } from "@/lib/dates";
import { formatDateMMDD } from "@/lib/format";
import { selectTrendTicks } from "@/lib/charts/trend-ticks";
import { absenceLabel, absenceText, bridgeSeriesValues, buildGapModel, isolatedPresentIndices, pendingTodayIndex } from "@/lib/charts/data-gaps";
import { EYEBROW, NeutralCard } from "./stat-card";

// ---------------------------------------------------------------------------

interface ScorePoint {
  date: string;
  sleepScore: number;
}

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
const TICK_TARGET = 7;

// Gap treatment: muted token colour, no new hex.
const GAP_STROKE = "var(--color-on-surface-variant)";
const ABSENT_TICK_PX = 6;
const ISOLATED_DOT_R = 2; // 4px diameter, same colour as the solid line
const LINE_COLOR = "#000000";

/** Padded, rounded-to-5 domain clamped to [0, 100]. */
function fittedDomain(min: number | null, max: number | null): [number, number] {
  if (min === null || max === null) return [0, 100];
  const lo = Math.max(0,   Math.floor((min - 5) / 5) * 5);
  const hi = Math.min(100, Math.ceil((max  + 5) / 5) * 5);
  return [lo, hi === lo ? lo + 10 : hi];
}

export default function SleepCharts({ data, lastSyncedAt = null }: { data: ScorePoint[]; lastSyncedAt?: string | null }) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const rawWindow = searchParams.get("scoreWindow");
  const activeWindow: HrWindow = isValidWindow(rawWindow) ? rawWindow : "week";

  const setWindow = (w: HrWindow) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("scoreWindow", w);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const series = data.map((d) => ({ date: d.date, value: d.sleepScore }));
  const trend  = calculateSeriesTrend(series, activeWindow, localToday());
  const { points, stats } = trend;

  const values = points.map((p) => p.value);
  // The series is keyed by night-of date: tonight's slot cannot exist yet, so it is not a gap.
  const pendingIdx = pendingTodayIndex(points.map((p) => p.date), values, localToday(), true);
  const gaps = buildGapModel(values, { ignoreIndex: pendingIdx });
  const isolated = new Set(isolatedPresentIndices(values));
  const lastSyncedAtMs = lastSyncedAt ? Date.parse(lastSyncedAt) : null;
  const [domainMin, domainMax] = fittedDomain(stats.min, stats.max);

  const bridgeValues = gaps.bridges.map((b) => bridgeSeriesValues(values, b));

  const chartData = points.map((p, i) => {
    const row: Record<string, number | string | boolean | null> = {
      date:        p.date,
      displayDate: formatDateMMDD(p.date),
      sleepScore:  p.value,
      // Baseline tick anchor: only absent days carry a value, pinned to the axis floor.
      absentTick:  p.value === null && i !== pendingIdx ? domainMin : null,
      // Anchor dot only for a score with no solid-line neighbour (nothing else would draw it).
      isolatedDot: isolated.has(i) ? p.value : null,
      pending:     i === pendingIdx,
    };
    bridgeValues.forEach((vals, k) => { row[`bridge${k}`] = vals[i]; });
    return row;
  });

  const tickIndices = selectTrendTicks(chartData.length, TICK_TARGET);

  return (
    <NeutralCard className="flex flex-col">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className={`${EYEBROW} text-on-surface-variant`}>Sleep score trend</h2>
          <p className="mt-1.5 text-sm text-on-surface-variant">
            Composite of volume, continuity, disruption &amp; cardiac recovery — as of today
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

      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: -30, bottom: 0 }}>
            <defs>
              <linearGradient id="colorSleepScore" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f5fda9" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#f5fda9" stopOpacity={0.0} />
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
              tickFormatter={(value, index) => tickIndices.has(index) ? value : ""}
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
                const score = row.sleepScore;
                const text = score !== null
                  ? `Sleep Score : ${score}`
                  : absenceText(absenceLabel(String(row.date), { today: localToday(), lastSyncedAtMs, nowMs: Date.now() }));
                return (
                  <div style={{ backgroundColor: "#1c1c16", borderRadius: 8, padding: "10px 12px" }}>
                    <p style={{ color: "#ffffff", fontFamily: "var(--font-display)", fontWeight: "bold", margin: 0 }}>{label}</p>
                    <p style={{ color: "#e5e2d9", fontFamily: "var(--font-sans)", margin: "4px 0 0" }}>{text}</p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="sleepScore"
              stroke="#000000"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorSleepScore)"
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
                cx == null || cy == null ? <g key={index} /> : <circle key={index} cx={cx} cy={cy} r={ISOLATED_DOT_R} fill={LINE_COLOR} />
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {(gaps.bridges.length > 0 || gaps.absentIndices.length > 0) && (
        <p className="mt-3 text-xs text-on-surface-variant">Dotted line or gray tick: no reading that day.</p>
      )}
    </NeutralCard>
  );
}
