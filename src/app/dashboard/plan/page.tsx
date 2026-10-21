import { auth } from "@/auth";
import { readPlan } from "@/lib/today/read";
import ExpandableCard from "../components/expandable-card";
import WorkoutsSection from "./components/workouts-section";
import MealsSection from "./components/meals-section";
import ConditionsSection from "./components/conditions-section";
import MindsetSection from "./components/mindset-section";
import MotivationSection from "./components/motivation-section";

export default async function PlanPage() {
  // The layout redirects unauthenticated users, but pages render in parallel
  // with it, so guard here instead of letting readPlan throw.
  const session = await auth();
  if (!session?.user?.id) return null;

  const plan = await readPlan(session.user.id);

  const activeConditions = plan.conditions.filter((c) => !c.archived).length;
  const mantras = plan.mindset.filter((m) => m.kind === "mantra").length;
  const strategies = plan.mindset.length - mantras;

  return (
    <div className="p-margin-mobile md:p-margin-desktop max-w-4xl mx-auto space-y-6 py-10 pb-24">
      <div>
        <h1 className="font-display text-4xl font-bold text-on-surface tracking-tight">Plan</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Templates for your Today screen. Past days keep the text they were logged with.
        </p>
      </div>

      <ExpandableCard
        title="Weekly workouts"
        defaultExpanded
        overview={<p className="text-sm text-on-surface-variant">{plan.exercise.length} exercises across the week</p>}
      >
        <WorkoutsSection items={plan.exercise} />
      </ExpandableCard>

      <ExpandableCard
        title="Meal plan"
        overview={<p className="text-sm text-on-surface-variant">{plan.meals.length} planned meals across the week</p>}
      >
        <MealsSection items={plan.meals} />
      </ExpandableCard>

      <ExpandableCard
        title="Backup conditions"
        overview={<p className="text-sm text-on-surface-variant">{activeConditions} active conditions</p>}
      >
        <ConditionsSection conditions={plan.conditions} />
      </ExpandableCard>

      <ExpandableCard
        title="Mantras & strategies"
        overview={<p className="text-sm text-on-surface-variant">{mantras} mantras · {strategies} strategies</p>}
      >
        <MindsetSection items={plan.mindset} />
      </ExpandableCard>

      <ExpandableCard
        title="Motivation lines"
        overview={<p className="text-sm text-on-surface-variant">{plan.motivation.filter((l) => l.active).length} active lines</p>}
      >
        <MotivationSection lines={plan.motivation} />
      </ExpandableCard>
    </div>
  );
}
