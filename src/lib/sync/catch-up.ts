// Catch-up sync planning. Pure: dates in, plan out. No DB, Next or Google
// imports. Date math goes through src/lib/dates.ts only.

import { addDays, diffDays } from "@/lib/dates";

/**
 * Days back from today that the routine "recent" sync always re-fetches
 * (today − 3 .. today, the same span runGoogleSync has always used).
 */
export const RECENT_WINDOW_DAYS = 3;

/** Maximum civil days in one gap-fill chunk. */
export const CHUNK_DAYS = 14;

/** Inclusive range of local "YYYY-MM-DD" dates. */
export interface DateRange {
  from: string;
  to: string;
  days: number;
}

export interface CatchUpPlan {
  /** Always run first (subject to the staleness rule): today − 3 .. today. */
  recent: DateRange;
  /**
   * Gap chunks, oldest → newest, covering (syncedThrough + 1 .. recent.from − 1).
   * Empty when syncedThrough is null (gap tracking off: the recent window is
   * all that ever runs, which is the pre-catch-up behaviour) or when the gap
   * is already inside the recent window.
   */
  gapChunks: DateRange[];
  /** Total days across gapChunks. */
  gapDays: number;
}

function range(from: string, to: string): DateRange {
  return { from, to, days: diffDays(from, to) + 1 };
}

/**
 * Builds the catch-up plan. The gap ends the day before the recent window
 * starts so chunks and the recent window never overlap and leave no hole.
 */
export function planCatchUp(
  syncedThrough: string | null,
  today: string,
  recentWindowDays: number = RECENT_WINDOW_DAYS,
  chunkDays: number = CHUNK_DAYS,
): CatchUpPlan {
  const recent = range(addDays(today, -recentWindowDays), today);
  const gapChunks: DateRange[] = [];
  const step = Math.max(1, chunkDays); // a non-positive size would never advance

  if (syncedThrough !== null) {
    const gapEnd = addDays(recent.from, -1);
    for (let from = addDays(syncedThrough, 1); from <= gapEnd; from = addDays(from, step)) {
      const chunkEnd = addDays(from, step - 1);
      gapChunks.push(range(from, chunkEnd < gapEnd ? chunkEnd : gapEnd));
    }
  }

  return {
    recent,
    gapChunks,
    gapDays: gapChunks.reduce((sum, c) => sum + c.days, 0),
  };
}

/**
 * Cursor rule: syncedThrough only advances contiguously. A successfully
 * synced [chunkFrom, chunkTo] moves it to chunkTo only when the chunk starts
 * at or before syncedThrough + 1 (no day left between old cursor and chunk)
 * and actually reaches past the current cursor. Anything else, including a
 * null cursor (not tracked) or an inverted range, leaves it unchanged.
 */
export function advanceCursor(
  syncedThrough: string | null,
  chunkFrom: string,
  chunkTo: string,
): string | null {
  if (syncedThrough === null) return null;
  if (chunkFrom > chunkTo) return syncedThrough;
  if (chunkFrom > addDays(syncedThrough, 1)) return syncedThrough;
  return chunkTo > syncedThrough ? chunkTo : syncedThrough;
}

/**
 * Derives syncedThrough from the dates that have real data. Walks back from
 * today: the first missing day opens the most recent gap, and the first
 * covered day below that gap is the answer. Returns today when nothing is
 * missing, and null when no covered day exists below the gap.
 */
export function deriveSyncedThrough(coveredDates: readonly string[], today: string): string | null {
  const covered = new Set(coveredDates);
  if (covered.size === 0) return null;
  const earliest = [...covered].reduce((a, b) => (a < b ? a : b));

  let day = today;
  while (day >= earliest && covered.has(day)) day = addDays(day, -1);
  if (day < earliest) return today;

  while (day >= earliest && !covered.has(day)) day = addDays(day, -1);
  return day >= earliest ? day : null;
}

/** One unit of catch-up work: the recent window or the oldest gap chunk. */
export interface SyncUnit {
  kind: "recent" | "gap";
  range: DateRange;
}

export interface NextUnitInput {
  syncedThrough: string | null;
  today: string;
  /** The existing 6-hour staleness rule says the recent window is due. */
  stale: boolean;
  /** Manual Sync button: always run the recent window. */
  force: boolean;
}

/**
 * Chooses the single next unit of work, or null when fully caught up.
 *  1. Recent window when forced or stale (it keeps today fresh; the cursor
 *     rule stops it advancing syncedThrough while a gap precedes it).
 *  2. Otherwise the oldest gap chunk.
 *  3. Otherwise, if the cursor still lags today (the gap just closed, or a
 *     new day began), the recent window once more so it can advance the cursor.
 */
export function pickNextUnit(plan: CatchUpPlan, input: NextUnitInput): SyncUnit | null {
  if (input.force || input.stale) return { kind: "recent", range: plan.recent };
  if (plan.gapChunks.length > 0) return { kind: "gap", range: plan.gapChunks[0] };
  const lagging = input.syncedThrough !== null && input.syncedThrough < input.today;
  return lagging ? { kind: "recent", range: plan.recent } : null;
}

export interface GapProgress {
  daysDone: number;
  daysTotal: number;
}

/**
 * Stateless progress for the gap fill: the client echoes back the largest
 * total it has seen, so the total stays fixed while the remaining gap shrinks.
 */
export function gapProgress(
  previousTotal: number,
  gapDaysBefore: number,
  gapDaysRemaining: number,
): GapProgress {
  const daysTotal = Math.max(previousTotal, gapDaysBefore);
  return { daysDone: Math.max(0, daysTotal - gapDaysRemaining), daysTotal };
}
