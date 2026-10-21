"use client";

import { setMealChecked } from "@/app/actions/today";
import { MEAL_SLOTS, type MealSlot, type TodayPlan } from "@/lib/today/types";
import { ErrorLine, useRun } from "../../plan/components/plan-ui";
import { CheckRow } from "./workout-block";

const SLOT_LABEL: Record<MealSlot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

export default function MealBlock({ plan, title }: { plan: TodayPlan; title: string }) {
  const { run, pending, error } = useRun();
  const slots = MEAL_SLOTS.filter((s) => plan.meals[s].length > 0);

  return (
    <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">
      <h2 className="font-display text-xl font-bold text-on-surface tracking-tight mb-2">{title}</h2>
      {slots.length === 0 ? (
        <p className="text-sm text-on-surface-variant py-2">No meals planned for this day. Add them on the Plan page.</p>
      ) : (
        slots.map((slot) => (
          <section key={slot} className="mt-3 first:mt-0">
            <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">{SLOT_LABEL[slot]}</h3>
            <div className="divide-y divide-outline-variant/50">
              {plan.meals[slot].map((m) => (
                <CheckRow
                  key={`${m.mealPlanItemId ?? "log"}-${m.logId ?? "new"}`}
                  checked={m.followed}
                  disabled={pending}
                  onToggle={() =>
                    run(() =>
                      setMealChecked(
                        m.logId !== null
                          ? { date: plan.date, logId: m.logId, followed: !m.followed }
                          : { date: plan.date, mealPlanItemId: m.mealPlanItemId, followed: !m.followed },
                      ),
                    )
                  }
                >
                  {m.description}
                </CheckRow>
              ))}
            </div>
          </section>
        ))
      )}
      <ErrorLine error={error} />
    </div>
  );
}
