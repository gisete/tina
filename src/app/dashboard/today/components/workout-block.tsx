"use client";

import { useState } from "react";
import { logBackupWorkout, resetWorkout, skipWorkout, toggleWorkoutItem } from "@/app/actions/today";
import type { ConditionWithOptions, TodayPlan } from "@/lib/today/types";
import { ErrorLine, useRun } from "../../plan/components/plan-ui";

export function CheckRow({
  checked,
  disabled,
  onToggle,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className="w-full flex items-start gap-3 py-2 text-left disabled:opacity-60"
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${
          checked ? "bg-on-surface text-white border-on-surface" : "bg-surface-container-lowest border-outline-variant"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      <span className={`text-sm ${checked ? "text-on-surface-variant line-through" : "text-on-surface"}`}>{children}</span>
    </button>
  );
}

const SECONDARY_BTN =
  "rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50";

export default function WorkoutBlock({
  plan,
  conditions,
  title,
}: {
  plan: TodayPlan;
  conditions: ConditionWithOptions[];
  title: string;
}) {
  const { date, exercise } = plan;
  const { log, items } = exercise;
  const { run, pending, error } = useRun();
  const [openConditionId, setOpenConditionId] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);

  const openCondition = conditions.find((c) => c.id === openConditionId) ?? null;
  const statusLabel =
    log.kind === "unlogged" ? "Planned"
    : log.kind === "planned" ? "In progress"
    : log.kind === "backup" ? `Backup · ${log.conditionName}`
    : "Skipped";

  function chooseCondition(id: number): void {
    setOpenConditionId((cur) => (cur === id ? null : id));
    setPicked([]);
  }

  return (
    <div className="bg-white border border-outline-variant rounded-[1.5rem] p-card-padding">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 className="font-display text-xl font-bold text-on-surface tracking-tight">{title}</h2>
        <span className="px-2 py-0.5 bg-primary-container text-black font-semibold text-xs rounded-full">{statusLabel}</span>
      </div>

      {log.kind === "skipped" ? (
        <p className="text-sm text-on-surface-variant py-2">You skipped this day&apos;s workout.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-on-surface-variant py-2">Nothing planned for this day. Add workouts on the Plan page.</p>
      ) : (
        <div className="divide-y divide-outline-variant/50">
          {items.map((item, idx) => (
            <CheckRow key={`${idx}-${item.name}`} checked={item.done} disabled={pending} onToggle={() => run(() => toggleWorkoutItem(date, idx))}>
              <span className="font-semibold">{item.name}</span>
              {item.details && <span className="text-on-surface-variant"> · {item.details}</span>}
            </CheckRow>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {log.kind !== "skipped" && (
          <button className={SECONDARY_BTN} disabled={pending} onClick={() => run(() => skipWorkout(date))}>
            Skip
          </button>
        )}
        {log.kind !== "unlogged" && (
          <button className={SECONDARY_BTN} disabled={pending} onClick={() => run(() => resetWorkout(date))}>
            {log.kind === "skipped" ? "Undo skip" : "Reset to plan"}
          </button>
        )}
      </div>
      <ErrorLine error={error} />

      {conditions.length > 0 && (
        <div className="mt-5 pt-4 border-t border-outline-variant/50">
          <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Not feeling great?</h3>
          <div className="flex flex-wrap gap-2">
            {conditions.map((c) => (
              <button
                key={c.id}
                aria-pressed={openConditionId === c.id}
                onClick={() => chooseCondition(c.id)}
                className={`px-3 py-2 rounded-xl border text-sm transition-colors ${
                  openConditionId === c.id
                    ? "bg-on-surface text-white border-on-surface"
                    : "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {openCondition && (
            <div className="mt-3 animate-in fade-in duration-150">
              <p className="text-xs text-on-surface-variant mb-1">Pick what you&apos;ll do instead:</p>
              <div className="divide-y divide-outline-variant/50">
                {openCondition.options.map((o) => (
                  <CheckRow
                    key={o.id}
                    checked={picked.includes(o.id)}
                    disabled={pending}
                    onToggle={() => setPicked((cur) => (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id]))}
                  >
                    <span className="font-semibold">{o.name}</span>
                    {o.details && <span className="text-on-surface-variant"> · {o.details}</span>}
                  </CheckRow>
                ))}
              </div>
              <button
                className="mt-3 rounded-xl bg-on-surface text-white px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                disabled={pending || picked.length === 0}
                onClick={() => run(() => logBackupWorkout(date, openCondition.id, picked), () => { setOpenConditionId(null); setPicked([]); })}
              >
                Use this backup
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
