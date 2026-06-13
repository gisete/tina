"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import { startOfWeek, localToday, addDays } from "@/lib/dates";
import type { DebtHistoryEntry } from "@/lib/analytics/sleep";

type Range = "week" | "30d" | "90d";

function isValidRange(s: string | null): s is Range {
  return s === "week" || s === "30d" || s === "90d";
}

const RANGES: Array<{ key: Range; label: string }> = [
  { key: "week", label: "This week" },
  { key: "30d",  label: "30 days"   },
  { key: "90d",  label: "90 days"   },
];

interface Props {
  history: DebtHistoryEntry[];
}

export default function DebtChart({ history }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawRange = searchParams.get("range");
  const range: Range = isValidRange(rawRange) ? rawRange : "30d";

  const setRange = (r: Range) => {
    router.push(`${pathname}?range=${r}`, { scroll: false });
  };

  // Filter client-side; data covers full 90-day window from the server.
  const today = localToday();
  const cutoffs: Record<Range, string> = {
    week: startOfWeek(),
    "30d": addDays(today, -30),
    "90d": addDays(today, -90),
  };
  const cutoff = cutoffs[range];
  const filtered = history.filter((d) => d.date >= cutoff);

  const formatted = filtered.map((d) => ({
    ...d,
    displayDate: new Date(d.date + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
  }));

  return (
    <div>
      {/* Range filter */}
      <div className="flex gap-2 mb-6">
        {RANGES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setRange(key)}
            className={`px-4 py-1.5 text-sm font-semibold rounded-full transition-colors ${
              range === key
                ? "bg-on-surface text-white"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {formatted.length === 0 ? (
        <div className="flex items-center justify-center h-[320px] text-sm text-on-surface-variant">
          No data for this range.
        </div>
      ) : (
        <>
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={formatted} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="#f6f4ea" vertical={false} />

                {/* Left axis: decayed debt (line) */}
                <YAxis
                  yAxisId="debt"
                  stroke="#787869"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  style={{ fontFamily: "var(--font-sans)" }}
                  tickFormatter={(v) => `${v}h`}
                />
                {/* Right axis: per-night net (bars) */}
                <YAxis
                  yAxisId="net"
                  orientation="right"
                  stroke="#9ca3af"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  style={{ fontFamily: "var(--font-sans)" }}
                  tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}h`}
                />

                <XAxis
                  dataKey="displayDate"
                  stroke="#787869"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  style={{ fontFamily: "var(--font-sans)" }}
                  interval="preserveStartEnd"
                />

                <ReferenceLine yAxisId="net" y={0} stroke="#d1d5db" strokeWidth={1} />

                <Tooltip
                  contentStyle={{ backgroundColor: "#1c1c16", borderRadius: "8px", border: "none" }}
                  labelStyle={{ color: "#ffffff", fontFamily: "var(--font-display)", fontWeight: "bold" }}
                  itemStyle={{ color: "#e5e2d9", fontFamily: "var(--font-sans)" }}
                  formatter={(value, name) => {
                    const v = typeof value === "number" ? value : 0;
                    if (name === "runningDebtHours") return [`${v.toFixed(2)} hrs`, "Debt (decayed)"];
                    const sign = v > 0 ? "+" : "";
                    return [`${sign}${v.toFixed(2)} hrs`, v > 0 ? "Deficit" : "Surplus"];
                  }}
                />

                {/* Per-night deficit/surplus bars */}
                <Bar yAxisId="net" dataKey="netDifferenceHours" opacity={0.55} radius={[2, 2, 0, 0]} maxBarSize={24}>
                  {formatted.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.netDifferenceHours > 0 ? "#f59e0b" : "#6ee7b7"}
                    />
                  ))}
                </Bar>

                {/* Decayed running debt line */}
                <Line
                  yAxisId="debt"
                  type="monotone"
                  dataKey="runningDebtHours"
                  stroke="#787869"
                  strokeWidth={2}
                  dot={{ r: 3, stroke: "#000000", strokeWidth: 1.5, fill: "#ffffff" }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-6 mt-4 text-xs text-on-surface-variant">
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-0.5 bg-[#787869]" />
              <span>Decayed debt (hrs)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-amber-400 opacity-70" />
              <span>Deficit night</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-emerald-300 opacity-70" />
              <span>Surplus night</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
