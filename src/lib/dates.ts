// Local-timezone calendar-date helpers.
//
// All "YYYY-MM-DD" handling in this app must stay in the user's local
// timezone. `Date.prototype.toISOString()` and `new Date("YYYY-MM-DD")`
// both anchor to UTC midnight, which shifts the calendar date by a day for
// users ahead of or behind UTC — never use them for calendar dates.

/** Formats a Date as local "YYYY-MM-DD" — e.g. 2026-06-11. */
export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parses "YYYY-MM-DD" as local midnight (not UTC midnight). */
export function parseLocalDate(s: string): Date {
  const [year, month, day] = s.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Today's calendar date in the local timezone, as "YYYY-MM-DD". */
export function localToday(): string {
  return formatLocalDate(new Date());
}

/** Returns the "YYYY-MM-DD" string `offsetDays` away from the given one. */
export function addDays(dateStr: string, offsetDays: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + offsetDays);
  return formatLocalDate(d);
}

/**
 * Returns "YYYY-MM-DD" for the Monday that starts the ISO week containing
 * the given date (defaults to today). Uses local midnight arithmetic — never
 * UTC — so the result matches the user's wall-clock calendar week.
 */
export function startOfWeek(dateStr?: string): string {
  const d = dateStr ? parseLocalDate(dateStr) : new Date();
  // getDay() → 0 (Sun) … 6 (Sat). Monday is day 1, so offset = (day + 6) % 7.
  const daysFromMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysFromMonday);
  return formatLocalDate(d);
}

/**
 * Whole calendar days from `from` to `to` (negative when `to` is earlier).
 * Counted on UTC-anchored components, so a DST change inside the span can't
 * add or drop a day.
 */
export function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Minutes since local midnight (0–1439) for an instant. With a stored UTC
 * offset (seconds) the clock is the one the person was living in at that
 * moment; with null/undefined it falls back to the server-local zone, exactly
 * as `getHours()/getMinutes()` always did.
 */
export function localClockMinutes(t: number | string | Date, offsetSeconds?: number | null): number {
  const d = new Date(t);
  if (offsetSeconds === null || offsetSeconds === undefined) {
    return d.getHours() * 60 + d.getMinutes();
  }
  const shifted = new Date(d.getTime() + offsetSeconds * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * The offset to use for an instant inside a session, given the offsets stored
 * at its start and end. They are equal except across a DST change or zone
 * crossing mid-session; the exact transition instant isn't stored, so an
 * interior instant takes the offset of whichever end it is nearer to.
 * Null when the relevant offset is unknown (callers then fall back to the
 * server-local zone).
 */
export function offsetForInstant(
  tMs: number,
  startMs: number,
  endMs: number,
  startOffsetSeconds: number | null | undefined,
  endOffsetSeconds: number | null | undefined,
): number | null {
  const start = startOffsetSeconds ?? null;
  const end = endOffsetSeconds ?? null;
  if (start === end) return start;
  if (start === null || end === null) return start ?? end;
  return tMs - startMs <= endMs - tMs ? start : end;
}
