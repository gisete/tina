"use client";

import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  calculateSeriesTrend,
  type HrWindow,
} from "@/lib/analytics/hr-trends";
import { localToday } from "@/lib/dates";
import { SLEEP_SCORE_DOMAIN } from "@/lib/charts/trend-domain";
import { EYEBROW, NeutralCard } from "./stat-card";
import GapTrendChart from "./gap-trend-chart";

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

export default function SleepCharts({ data, lastSyncedAt = null }: { data: ScorePoint[]; lastSyncedAt?: string | null }) {
  const [nowMs]      = useState(() => Date.now());
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
  const { points } = calculateSeriesTrend(series, activeWindow, localToday());

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

      {/* The series is keyed by night-of date: tonight's slot cannot exist yet, so it is not a gap. */}
      <GapTrendChart
        points={points}
        seriesLabel="Sleep Score"
        color="#000000"
        fillColor="#f5fda9"
        gradientId="colorSleepScore"
        domain={SLEEP_SCORE_DOMAIN}
        todayIsPending
        lastSyncedAt={lastSyncedAt}
        nowMs={nowMs}
      />
    </NeutralCard>
  );
}
