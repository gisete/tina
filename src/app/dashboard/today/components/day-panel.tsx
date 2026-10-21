"use client";

import { useState } from "react";
import type { ConditionWithOptions, TodayPlan } from "@/lib/today/types";
import type { SleepNudge } from "@/lib/today/sleep-nudge";
import WorkoutBlock from "./workout-block";
import MealBlock from "./meal-block";

type DayKey = "today" | "yesterday";

const TABS: ReadonlyArray<{ key: DayKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
];

/**
 * Workout + meals for either of the two loggable days. Both days are resolved
 * on the server; the toggle only swaps which one is shown.
 */
export default function DayPanel({
  days,
  conditions,
  nudge,
}: {
  days: Record<DayKey, TodayPlan>;
  conditions: ConditionWithOptions[];
  nudge: SleepNudge | null;
}) {
  const [day, setDay] = useState<DayKey>("today");
  const plan = days[day];
  const noun = day === "today" ? "Today's" : "Yesterday's";

  return (
    <div className="space-y-5">
      <div role="tablist" className="inline-flex rounded-xl border border-outline-variant bg-surface-container-lowest p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={day === t.key}
            onClick={() => setDay(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              day === t.key ? "bg-on-surface text-white" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <WorkoutBlock key={`w-${plan.date}`} plan={plan} conditions={conditions} nudge={day === "today" ? nudge : null} title={`${noun} workout`} />
      <MealBlock key={`m-${plan.date}`} plan={plan} title={`${noun} meals`} />
    </div>
  );
}
