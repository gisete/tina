"use client";

import { useState, type ReactNode } from "react";
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
  heading,
  intro,
  children,
}: {
  /** Page title block; the day toggle sits at the right of this row. */
  heading: ReactNode;
  /** Optional line between the header row and the card grid. */
  intro?: ReactNode;
  /** Server-rendered stat cards, placed ahead of workout and meals in the grid. */
  children: ReactNode;
  days: Record<DayKey, TodayPlan>;
  conditions: ConditionWithOptions[];
  nudge: SleepNudge | null;
}) {
  const [day, setDay] = useState<DayKey>("today");
  const plan = days[day];
  const noun = day === "today" ? "Today's" : "Yesterday's";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        {heading}
        <div role="tablist" className="inline-flex w-fit rounded-full border border-outline-variant bg-white p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={day === t.key}
              onClick={() => setDay(t.key)}
              className={`min-h-11 px-[22px] rounded-full text-[15px] transition-colors ${
                day === t.key ? "bg-on-surface text-white font-medium" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {intro}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        {children}
        <WorkoutBlock key={`w-${plan.date}`} plan={plan} conditions={conditions} nudge={day === "today" ? nudge : null} title={`${noun} workout`} className="md:col-span-3" />
        <MealBlock key={`m-${plan.date}`} plan={plan} title={`${noun} meals`} className="md:col-span-3" />
      </div>
    </>
  );
}
