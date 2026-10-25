"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { EYEBROW, NeutralCard } from "./stat-card";

interface HeartChartDay {
  date: string;
  rhr: number | null;
  baselineRhr: number | null;
  hrv: number | null;
  baselineHrv: number | null;
  status: string;
}

const CHART_STYLE = {
  container: "flex h-[400px] flex-col",
  grid: { strokeDasharray: "4 4", stroke: "#f6f4ea", vertical: false } as const,
  axis: { stroke: "#787869", fontSize: 12, tickLine: false, axisLine: false, style: { fontFamily: "var(--font-sans)" } } as const,
  tooltip: {
    contentStyle: { backgroundColor: "#1c1c16", borderRadius: "8px", border: "none" },
    labelStyle: { color: "#ffffff", fontFamily: "var(--font-display)", fontWeight: "bold" },
    itemStyle: { color: "#e5e2d9", fontFamily: "var(--font-sans)" },
  },
  margin: { top: 10, right: 10, left: -30, bottom: 0 },
};

export default function HeartCharts({ data }: { data: HeartChartDay[] }) {
  const formatted = data.map((d) => ({
    ...d,
    displayDate: new Date(d.date).toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    }),
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

      {/* Resting HR trend */}
      <NeutralCard className={CHART_STYLE.container}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className={`${EYEBROW} text-on-surface-variant`}>Resting HR trend</h3>
            <p className="mt-1.5 text-sm text-on-surface-variant">Actual vs 7-day rolling baseline</p>
          </div>
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">bpm</span>
        </div>

        <div className="flex-1 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formatted} margin={CHART_STYLE.margin}>
              <CartesianGrid {...CHART_STYLE.grid} />
              <XAxis dataKey="displayDate" {...CHART_STYLE.axis} />
              <YAxis {...CHART_STYLE.axis} />
              <Tooltip
                {...CHART_STYLE.tooltip}
                formatter={(value, name) => [
                  `${value} bpm`,
                  name === "rhr" ? "Resting HR" : "7-Day Baseline",
                ]}
              />
              {/* Actual RHR — solid, prominent */}
              <Line
                type="monotone"
                dataKey="rhr"
                name="rhr"
                stroke="#1b1b1b"
                strokeWidth={2}
                dot={{ r: 3, stroke: "#1b1b1b", strokeWidth: 2, fill: "#ffffff" }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
              {/* Rolling baseline — dashed reference line */}
              <Line
                type="monotone"
                dataKey="baselineRhr"
                name="baselineRhr"
                stroke="#cfc4c5"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                connectNulls={true}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-6 mt-3 pt-3 border-t border-hairline">
          <div className="flex items-center gap-2">
            <span className="block w-4 h-0.5 bg-on-surface rounded" />
            <span className="text-xs text-on-surface-variant font-medium">Actual</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="block w-4 border-t border-dashed border-outline" />
            <span className="text-xs text-on-surface-variant font-medium">Baseline</span>
          </div>
        </div>
      </NeutralCard>

      {/* HRV trend */}
      <NeutralCard className={CHART_STYLE.container}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className={`${EYEBROW} text-on-surface-variant`}>HRV trend</h3>
            <p className="mt-1.5 text-sm text-on-surface-variant">Actual vs 7-day rolling baseline</p>
          </div>
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">ms</span>
        </div>

        <div className="flex-1 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formatted} margin={CHART_STYLE.margin}>
              <CartesianGrid {...CHART_STYLE.grid} />
              <XAxis dataKey="displayDate" {...CHART_STYLE.axis} />
              <YAxis {...CHART_STYLE.axis} />
              <Tooltip
                {...CHART_STYLE.tooltip}
                formatter={(value, name) => [
                  `${value} ms`,
                  name === "hrv" ? "HRV RMSSD" : "7-Day Baseline",
                ]}
              />
              {/* Actual HRV — lavender-purple, solid */}
              <Line
                type="monotone"
                dataKey="hrv"
                name="hrv"
                stroke="#7B6FA8"
                strokeWidth={2}
                dot={{ r: 3, stroke: "#7B6FA8", strokeWidth: 2, fill: "#ffffff" }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
              {/* Rolling baseline — dashed reference */}
              <Line
                type="monotone"
                dataKey="baselineHrv"
                name="baselineHrv"
                stroke="#cfc4c5"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                connectNulls={true}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-6 mt-3 pt-3 border-t border-hairline">
          <div className="flex items-center gap-2">
            <span className="block w-4 h-0.5 rounded" style={{ backgroundColor: "#7B6FA8" }} />
            <span className="text-xs text-on-surface-variant font-medium">Actual</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="block w-4 border-t border-dashed border-outline" />
            <span className="text-xs text-on-surface-variant font-medium">Baseline</span>
          </div>
        </div>
      </NeutralCard>

    </div>
  );
}
