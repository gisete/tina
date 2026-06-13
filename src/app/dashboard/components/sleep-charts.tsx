"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface EfficiencyPoint {
  date: string;
  efficiency: number;
}

export default function SleepCharts({ data }: { data: EfficiencyPoint[] }) {
  const formattedData = data.map((d) => ({
    date: d.date,
    efficiency: d.efficiency,
    displayDate: new Date(d.date + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    }),
  }));

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding h-[320px] flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-display text-xl font-semibold text-black tracking-tight">Efficiency Trend</h3>
        <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Recent nights</span>
      </div>
      <div className="flex-1 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: -30, bottom: 0 }}>
            <defs>
              <linearGradient id="colorEfficiency" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f5fda9" stopOpacity={0.8} />
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
            />
            <YAxis
              domain={[60, 100]}
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
              formatter={(value) => [`${value}%`, "Efficiency"]}
            />
            <Area
              type="monotone"
              dataKey="efficiency"
              stroke="#000000"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorEfficiency)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
