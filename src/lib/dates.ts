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
