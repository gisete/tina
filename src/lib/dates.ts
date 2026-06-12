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
