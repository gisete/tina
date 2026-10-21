import { auth } from "@/auth";
import { addDays, localToday } from "@/lib/dates";
import { buildSleepNudge, isSyncStale, pickMotivationLine, resolveDay, TODAY_STALE_AFTER_HOURS } from "@/lib/today";
import {
  readExerciseLog,
  readLastNightScore,
  readLastSyncedAtMs,
  readMealLogs,
  readPlan,
  readSteps,
} from "@/lib/today/read";
import AutoSync from "../components/auto-sync";
import DayPanel from "./components/day-panel";
import { Mantras, Strategies } from "./components/mindset-blocks";
import StepsCard from "./components/steps-card";
import SleepCard from "./components/sleep-card";

export default async function TodayPage() {
  // The layout redirects unauthenticated users, but pages render in parallel
  // with it, so guard here instead of letting the reads throw.
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  const today = localToday();
  const yesterday = addDays(today, -1);

  // Stored data only: nothing on this path calls Google. Fresh data arrives
  // via <AutoSync>, which fires the existing sync action after paint.
  const [plan, exToday, exYesterday, mealsToday, mealsYesterday, steps, lastNight, lastSyncedMs] = await Promise.all([
    readPlan(userId),
    readExerciseLog(userId, today),
    readExerciseLog(userId, yesterday),
    readMealLogs(userId, today),
    readMealLogs(userId, yesterday),
    readSteps(userId, today),
    readLastNightScore(userId, today),
    readLastSyncedAtMs(userId),
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
  const shouldAutoSync = isSyncStale(lastSyncedMs, Date.now(), TODAY_STALE_AFTER_HOURS);

  return (
    <div className="p-margin-mobile md:p-margin-desktop max-w-3xl mx-auto space-y-6 py-10 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-display text-4xl font-bold text-on-surface tracking-tight">Today</h1>
        <AutoSync shouldSync={shouldAutoSync} />
      </div>

      {motivation && (
        <p className="font-display text-lg font-semibold text-on-surface tracking-tight">{motivation.text}</p>
      )}

      <DayPanel days={days} conditions={conditions} nudge={nudge} />

      <Mantras items={plan.mindset.filter((m) => m.kind === "mantra")} />
      <Strategies items={plan.mindset.filter((m) => m.kind === "strategy")} />

      <StepsCard steps={steps} />
      <SleepCard night={lastNight} />
    </div>
  );
}
