"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { PlanResult } from "@/app/actions/plan";
import type { IsoWeekday } from "@/lib/today/types";

/** Runs a plan action in a transition and surfaces its error string. */
export function useRun(): {
  run: (action: () => Promise<PlanResult>, onOk?: () => void) => void;
  pending: boolean;
  error: string | null;
} {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<PlanResult>, onOk?: () => void): void {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        onOk?.();
      } else {
        setError(result.error);
      }
    });
  }

  return { run, pending, error };
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs font-semibold text-on-surface mt-2">
      ⚠ {error}
    </p>
  );
}

// ── Weekday tabs ─────────────────────────────────────────────────────────────

const WEEKDAYS: ReadonlyArray<{ id: IsoWeekday; short: string; long: string }> = [
  { id: 1, short: "Mon", long: "Monday" },
  { id: 2, short: "Tue", long: "Tuesday" },
  { id: 3, short: "Wed", long: "Wednesday" },
  { id: 4, short: "Thu", long: "Thursday" },
  { id: 5, short: "Fri", long: "Friday" },
  { id: 6, short: "Sat", long: "Saturday" },
  { id: 7, short: "Sun", long: "Sunday" },
];

export const weekdayName = (id: IsoWeekday): string => WEEKDAYS[id - 1].long;

export function WeekdayTabs({
  value,
  onChange,
  counts,
}: {
  value: IsoWeekday;
  onChange: (day: IsoWeekday) => void;
  /** Optional item count per weekday, shown as a dot when non-zero. */
  counts?: Partial<Record<IsoWeekday, number>>;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1.5 mb-4">
      {WEEKDAYS.map((d) => (
        <button
          key={d.id}
          role="tab"
          aria-selected={value === d.id}
          onClick={() => onChange(d.id)}
          className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
            value === d.id
              ? "bg-on-surface text-white border-on-surface"
              : "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container"
          }`}
        >
          {d.short}
          {(counts?.[d.id] ?? 0) > 0 && <span aria-label="has items"> •</span>}
        </button>
      ))}
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 rounded-lg text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function Row({ children, actions, muted }: { children: ReactNode; actions: ReactNode; muted?: boolean }) {
  return (
    <li
      className={`flex items-start justify-between gap-3 py-2 border-b border-outline-variant/50 last:border-b-0 ${
        muted ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-0 text-sm text-on-surface">{children}</div>
      <div className="flex shrink-0 items-center">{actions}</div>
    </li>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-on-surface-variant py-2">{children}</p>;
}

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mt-5 mb-1">{children}</h3>
  );
}

// ── Generic fields form (add + edit) ─────────────────────────────────────────

export interface Field {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number";
  /** Tailwind width class for the input wrapper. */
  width?: string;
}

const INPUT =
  "w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-on-surface";

export function FieldsForm({
  fields,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  fields: Field[];
  initial?: Record<string, string>;
  submitLabel: string;
  pending: boolean;
  /** Call `done` once the save succeeded: it resets (add) or closes (edit) the form. */
  onSubmit: (values: Record<string, string>, done: () => void) => void;
  onCancel?: () => void;
}) {
  const blank = Object.fromEntries(fields.map((f) => [f.name, initial?.[f.name] ?? ""]));
  const [values, setValues] = useState<Record<string, string>>(blank);

  return (
    <form
      className="flex flex-wrap items-end gap-2 mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values, () => {
          if (onCancel) onCancel();
          else setValues(blank);
        });
      }}
    >
      {fields.map((f, i) => (
        <label key={f.name} className={`flex flex-col gap-1 ${f.width ?? "flex-1 min-w-40"}`}>
          <span className="text-xs font-semibold text-on-surface-variant">{f.label}</span>
          <input
            className={INPUT}
            type={f.type ?? "text"}
            inputMode={f.type === "number" ? "numeric" : undefined}
            placeholder={f.placeholder}
            value={values[f.name]}
            autoFocus={Boolean(onCancel) && i === 0}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </label>
      ))}
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-on-surface text-white px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {submitLabel}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
        >
          Cancel
        </button>
      )}
    </form>
  );
}
