"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface ChartData {
  date: string;
  efficiency: number;
  runningDebtHours: number;
}

export default function SleepCharts({ data }: { data: ChartData[] }) {
  const formattedData = data.map((d) => {
    const dateObj = new Date(d.date);
    return {
      ...d,
      displayDate: dateObj.toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      }),
    };
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
      {/* Efficiency Area Chart */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding h-[360px] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-display text-xl font-semibold text-black tracking-tight">Efficiency Trend</h3>
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">7 Days</span>
        </div>
        <div className="flex-1 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: -30, bottom: 0 }}>
              <defs>
                <linearGradient id="colorEfficiency" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f5fda9" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#f5fda9" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="#f6f4ea" vertical={false} />
              <XAxis dataKey="displayDate" stroke="#787869" fontSize={12} tickLine={false} axisLine={false} style={{ fontFamily: "var(--font-sans)" }} />
              <YAxis domain={[60, 100]} stroke="#787869" fontSize={12} tickLine={false} axisLine={false} style={{ fontFamily: "var(--font-sans)" }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1c1c16", borderRadius: "8px", border: "none" }}
                labelStyle={{ color: "#ffffff", fontFamily: "var(--font-display)", fontWeight: "bold" }}
                itemStyle={{ color: "#e5e2d9", fontFamily: "var(--font-sans)" }}
                formatter={(value) => [`${value}%`, "Efficiency"]}
              />
              <Area type="monotone" dataKey="efficiency" stroke="#000000" strokeWidth={2} fillOpacity={1} fill="url(#colorEfficiency)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Debt Line Chart */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-[1.5rem] p-card-padding h-[360px] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-display text-xl font-semibold text-black tracking-tight">Debt Timeline</h3>
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Hrs</span>
        </div>
        <div className="flex-1 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formattedData} margin={{ top: 10, right: 10, left: -30, bottom: 0 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#f6f4ea" vertical={false} />
              <XAxis dataKey="displayDate" stroke="#787869" fontSize={12} tickLine={false} axisLine={false} style={{ fontFamily: "var(--font-sans)" }} />
              <YAxis stroke="#787869" fontSize={12} tickLine={false} axisLine={false} style={{ fontFamily: "var(--font-sans)" }} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1c1c16", borderRadius: "8px", border: "none" }}
                labelStyle={{ color: "#ffffff", fontFamily: "var(--font-display)", fontWeight: "bold" }}
                itemStyle={{ color: "#e5e2d9", fontFamily: "var(--font-sans)" }}
                formatter={(value) => [`${value} hrs`, "Sleep Debt"]}
              />
              <Line type="monotone" dataKey="runningDebtHours" stroke="#787869" strokeWidth={1.5} dot={{ r: 4, stroke: "#000000", strokeWidth: 2, fill: "#ffffff" }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
