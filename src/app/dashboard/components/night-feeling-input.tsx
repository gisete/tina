"use client";

import { useState, useTransition } from "react";
import { FEELING_TAGS } from "@/lib/analytics/feeling-tags";
import { setNightFeeling } from "@/app/actions/feelings";

interface Props {
  nightOf: string;        // "YYYY-MM-DD" sleep-date — stored verbatim; key={nightOf} ensures remount per night
  initialTagIds: number[];
  isCurrentNight: boolean;
}

const PILL_ACTIVE   = "bg-on-surface text-white border-on-surface";
const PILL_INACTIVE = "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container";

export default function NightFeelingInput({ nightOf, initialTagIds, isCurrentNight }: Props) {
  // Lazy initializers run once at mount; key={nightOf} guarantees a fresh mount per night.
  const [savedId, setSavedId] = useState<number | null>(
    () => initialTagIds.find((id) => FEELING_TAGS.some((t) => t.id === id)) ?? null,
  );
  const [editId, setEditId] = useState<number | null>(
    () => initialTagIds.find((id) => FEELING_TAGS.some((t) => t.id === id)) ?? null,
  );
  const [isEditing, setIsEditing]    = useState(false);
  const [isPending, startTransition] = useTransition();

  const savedTag = FEELING_TAGS.find((t) => t.id === savedId);

  function startEdit(): void {
    setEditId(savedId);
    setIsEditing(true);
  }

  function cancel(): void {
    setEditId(savedId);
    setIsEditing(false);
  }

  function save(): void {
    startTransition(async () => {
      const result = await setNightFeeling(nightOf, editId != null ? [editId] : []);
      if (result.ok) {
        setSavedId(editId);
        setIsEditing(false);
      }
    });
  }

  // ── EDIT ─────────────────────────────────────────────────────────────────────
  if (isEditing) {
    return (
      <div className="animate-in fade-in duration-150">
        <div className="flex flex-wrap gap-2 mb-5">
          {FEELING_TAGS.map((tag) => (
            <button
              key={tag.id}
              onClick={() => setEditId(tag.id === editId ? null : tag.id)}
              disabled={isPending}
              className={`text-left px-3 py-2 rounded-xl border text-sm transition-colors ${
                editId === tag.id ? PILL_ACTIVE : PILL_INACTIVE
              }`}
            >
              <span className="block font-semibold leading-tight">{tag.slug}</span>
              <span className="block text-xs mt-0.5 leading-tight opacity-70">{tag.description}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={isPending}
            className="px-4 py-2 rounded-xl bg-on-surface text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          <button
            onClick={cancel}
            disabled={isPending}
            className="px-4 py-2 rounded-xl border border-outline-variant text-on-surface-variant text-sm font-semibold hover:bg-surface-container transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── SAVED ────────────────────────────────────────────────────────────────────
  if (savedId != null && savedTag != null) {
    return (
      <div className="animate-in fade-in duration-150 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1">
            {isCurrentNight ? "Today I feel" : "That morning I felt"}
          </p>
          <p className="text-base font-semibold text-on-surface">{savedTag.description}</p>
        </div>
        <button
          onClick={startEdit}
          className="shrink-0 mt-0.5 px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant text-xs font-semibold hover:bg-surface-container transition-colors"
        >
          Edit
        </button>
      </div>
    );
  }

  // ── CTA ──────────────────────────────────────────────────────────────────────
  return (
    <div className="animate-in fade-in duration-150">
      <p className="text-sm text-on-surface-variant mb-4">
        Log how you felt waking up from this night.
      </p>
      <button
        onClick={startEdit}
        className="px-4 py-2 rounded-xl bg-on-surface text-white text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Record how you feel
      </button>
    </div>
  );
}
