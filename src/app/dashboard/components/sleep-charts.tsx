"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
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

/** Padded, rounded-to-5 domain clamped to [0, 100]. */
function fittedDomain(min: number | null, max: number | null): [number, number] {
  if (min === null || max === null) return [0, 100];
  const lo = Math.max(0,   Math.floor((min - 5) / 5) * 5);
  const hi = Math.min(100, Math.ceil((max  + 5) / 5) * 5);
  return [lo, hi === lo ? lo + 10 : hi];
}

export default function SleepCharts({ data }: { data: ScorePoint[] }) {
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

  const chartData = points.map((p) => ({
    displayDate: formatDateMMDD(p.date),
    sleepScore:  p.value,
  }));

  const tickIndices             = selectTrendTicks(chartData.length, TICK_TARGET);
  const [domainMin, domainMax]  = fittedDomain(stats.min, stats.max);

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="font-display text-xl font-semibold text-black tracking-tight">Sleep Score Trend</h3>
          <p className="text-xs text-on-surface-variant mt-0.5">
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
          <AreaChart data={chartData} margin={{ top: 6, right: 10, left: -30, bottom: 0 }}>
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
              contentStyle={{ backgroundColor: "#1c1c16", borderRadius: "8px", border: "none" }}
              labelStyle={{ color: "#ffffff", fontFamily: "var(--font-display)", fontWeight: "bold" }}
              itemStyle={{ color: "#e5e2d9", fontFamily: "var(--font-sans)" }}
              formatter={(value) =>
                value != null ? [`${value}`, "Sleep Score"] : ["—", "Sleep Score"]
              }
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
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
