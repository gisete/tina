import { auth } from "@/auth";
import { addDays, localToday } from "@/lib/dates";
import { buildSleepNudge, pickMotivationLine, resolveDay } from "@/lib/today";
import {
  readExerciseLog,
  readLastNightScore,
  readMealLogs,
  readPlan,
  readSteps,
} from "@/lib/today/read";
import { PageShell, PageTitle } from "../components/page-shell";
import DayPanel from "./components/day-panel";
import { Mantras, Strategies } from "./components/mindset-blocks";
import StepsCard from "./components/steps-card";
import SleepCard from "./components/sleep-card";
import NightHeartCard from "./components/night-heart-card";
import { formatWeekdayMonthDay } from "@/lib/format";

export default async function TodayPage() {
  // The layout redirects unauthenticated users, but pages render in parallel
  // with it, so guard here instead of letting the reads throw.
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  const today = localToday();
  const yesterday = addDays(today, -1);

  // Stored data only: nothing on this path calls Google. Fresh data arrives
  // via the layout-level <CatchUpSync>, which calls the sync-step endpoint after paint.
  const [plan, exToday, exYesterday, mealsToday, mealsYesterday, steps, lastNight] = await Promise.all([
    readPlan(userId),
    readExerciseLog(userId, today),
    readExerciseLog(userId, yesterday),
    readMealLogs(userId, today),
    readMealLogs(userId, yesterday),
    readSteps(userId, today),
    readLastNightScore(userId, today),
  ]);

  const templates = { exercise: plan.exercise, meals: plan.meals };
  const days = {
    today: resolveDay(today, templates, { exercise: exToday, meals: mealsToday }),
    yesterday: resolveDay(yesterday, templates, { exercise: exYesterday, meals: mealsYesterday }),
  };

  // Archived conditions/options never appear; a condition with no usable option is skipped.
  const conditions = plan.conditions
    .filter((c) => !c.archived)
    .map((c) => ({ ...c, options: c.options.filter((o) => !o.archived) }))
    .filter((c) => c.options.length > 0);

  // Suggestion only: highlights conditions whose sleep-score threshold last
  // night's stored score fell below. Only shown conditions can be nudged.
  const nudge = buildSleepNudge(lastNight.kind === "scored" ? lastNight.score : null, conditions);

  const motivation = pickMotivationLine(today, plan.motivation);

  return (
    <PageShell>
      <DayPanel
        days={days}
        conditions={conditions}
        nudge={nudge}
        heading={
          <PageTitle meta={formatWeekdayMonthDay(today)}>Today</PageTitle>
        }
        intro={
          motivation && (
            <p className="font-display text-lg font-semibold text-on-surface tracking-tight">{motivation.text}</p>
          )
        }
      >
        <SleepCard night={lastNight} className="md:col-span-4 md:row-span-2" />
        <NightHeartCard night={lastNight} className="md:col-span-2" />
        <StepsCard steps={steps} className="md:col-span-2" />
      </DayPanel>

      <Mantras items={plan.mindset.filter((m) => m.kind === "mantra")} />
      <Strategies items={plan.mindset.filter((m) => m.kind === "strategy")} />
    </PageShell>
  );
}
