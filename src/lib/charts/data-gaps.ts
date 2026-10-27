// Pure gap model for trend charts — primitives in, primitives out.
// No React/Next/DB imports. A day with no row is a normal state ("No reading"),
// never an error: nothing here imputes, extrapolates or holds a value.

import { addDays } from "@/lib/dates";
import { RECENT_WINDOW_DAYS, STALE_AFTER_HOURS } from "@/lib/sync/catch-up";
import { isSyncStale } from "@/lib/today/log-date";

/** A dotted connector between two real points that have only absent days between them. */
export interface GapBridge {
  /** Index of the last present point before the run of absent days. */
  fromIndex: number;
  /** Index of the first present point after it. */
  toIndex: number;
}

export interface GapModel {
  presentIndices: number[];
  /** Every null index: leading, interior and trailing. */
  absentIndices: number[];
  /**
   * One per maximal run of nulls that sits between two present points. Leading
   * and trailing absences get none. Every index strictly between fromIndex and
   * toIndex is null in the input.
   */
  bridges: GapBridge[];
  /** Nulls before the first present point. With no present point at all, every index is leading. */
  leadingAbsent: number[];
  /** Nulls after the last present point. Empty when there is no present point. */
  trailingAbsent: number[];
}

export function buildGapModel(points: readonly (number | null)[]): GapModel {
  const presentIndices: number[] = [];
  const absentIndices: number[] = [];
  const bridges: GapBridge[] = [];

  let lastPresent = -1;
  points.forEach((v, i) => {
    if (v === null) {
      absentIndices.push(i);
      return;
    }
    // A bridge needs a present point before the run and at least one null in it.
    if (lastPresent !== -1 && i - lastPresent > 1) bridges.push({ fromIndex: lastPresent, toIndex: i });
    presentIndices.push(i);
    lastPresent = i;
  });

  const first = presentIndices.length > 0 ? presentIndices[0] : points.length;
  const last = presentIndices.length > 0 ? presentIndices[presentIndices.length - 1] : -1;

  return {
    presentIndices,
    absentIndices,
    bridges,
    leadingAbsent: absentIndices.filter((i) => i < first),
    trailingAbsent: presentIndices.length > 0 ? absentIndices.filter((i) => i > last) : [],
  };
}

/**
 * Values for one bridge's own two-point series: the real values at the bridge
 * ends, null everywhere else. Drawing it as a separate series (never one
 * series with connectNulls) keeps a dotted line from ever spanning a present run.
 */
export function bridgeSeriesValues(points: readonly (number | null)[], bridge: GapBridge): (number | null)[] {
  return points.map((v, i) => (i === bridge.fromIndex || i === bridge.toIndex ? v : null));
}

export type AbsenceLabel = "not-synced-yet" | "no-reading";

export interface AbsenceContext {
  /** Local "YYYY-MM-DD". */
  today: string;
  lastSyncedAtMs: number | null;
  nowMs: number;
}

/**
 * Why a day has no row. "not-synced-yet" only while the day is still inside the
 * routine re-fetch window (today − RECENT_WINDOW_DAYS .. today) and the last
 * sync is stale; otherwise a synced day with no row is simply "no-reading".
 */
export function absenceLabel(date: string, ctx: AbsenceContext): AbsenceLabel {
  const inRefetchWindow = date >= addDays(ctx.today, -RECENT_WINDOW_DAYS) && date <= ctx.today;
  return inRefetchWindow && isSyncStale(ctx.lastSyncedAtMs, ctx.nowMs, STALE_AFTER_HOURS)
    ? "not-synced-yet"
    : "no-reading";
}

/** User-facing text for an absence. Deliberately neutral. */
export function absenceText(label: AbsenceLabel): string {
  return label === "not-synced-yet" ? "Not synced yet" : "No reading";
}
