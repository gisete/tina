// Which night does a picked date imply, and is it actually recorded? Pure: no
// React/DB imports. Date math goes through src/lib/dates.ts only.

import { addDays } from "@/lib/dates";
import { selectMainSessions } from "./sessions";

interface NightSession {
  sleepDate: string;
  totalSleepMs: number;
}

export type SelectedNight<T extends NightSession> =
  | { status: "recorded"; session: T; nightOf: string }
  | {
      status: "missing";
      /** The night the picked date implies: the day before it. */
      expectedNightOf: string;
      /** Most recent earlier night; only offered when the picked date is today. */
      fallback: { session: T; nightOf: string } | null;
    };

/**
 * Picking date D shows the night the user woke up from on D, i.e. the main
 * session keyed (sleepDate / "nightOf") D − 1. When that night has no session
 * the result is "missing" rather than silently showing an older night. For
 * today only (the night may simply not have synced yet) the most recent
 * earlier night comes back as a clearly separate fallback; for any past date
 * a gap is a gap, so fallback is null.
 */
export function resolveSelectedNight<T extends NightSession>(input: {
  sessions: readonly T[];
  selectedDate: string;
  today: string;
}): SelectedNight<T> {
  const { sessions, selectedDate, today } = input;
  const expectedNightOf = addDays(selectedDate, -1);
  const mains = selectMainSessions([...sessions]);

  const recorded = mains.find((s) => s.sleepDate === expectedNightOf);
  if (recorded) return { status: "recorded", session: recorded, nightOf: expectedNightOf };

  let fallback: { session: T; nightOf: string } | null = null;
  if (selectedDate === today) {
    for (const s of mains) {
      if (s.sleepDate < expectedNightOf && (!fallback || s.sleepDate > fallback.nightOf)) {
        fallback = { session: s, nightOf: s.sleepDate };
      }
    }
  }
  return { status: "missing", expectedNightOf, fallback };
}

/** Serializable summary of a resolution: night keys only, no session objects. */
export type SelectedNightView =
  | { status: "recorded"; nightOf: string }
  | { status: "missing"; expectedNightOf: string; fallbackNightOf: string | null };

export function toSelectedNightView(resolved: SelectedNight<NightSession>): SelectedNightView {
  return resolved.status === "recorded"
    ? { status: "recorded", nightOf: resolved.nightOf }
    : { status: "missing", expectedNightOf: resolved.expectedNightOf, fallbackNightOf: resolved.fallback?.nightOf ?? null };
}
