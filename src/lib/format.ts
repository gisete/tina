// User-facing display formatters shared across pages and chart components.

import { addDays, parseLocalDate } from "@/lib/dates";

/** "11:35 PM" — accepts a Unix-ms timestamp, ISO string, or Date. */
export function formatClockTime(t: number | string | Date): string {
  return new Date(t).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** 126 → "2h 6m" · 120 → "2h" · 45 → "45m" */
export function formatDurationMins(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Millisecond variant of {@link formatDurationMins}. */
export function formatDurationMs(ms: number): string {
  return formatDurationMins(Math.round(ms / 60000));
}

/**
 * "YYYY-MM-DD" → "MM/DD"
 * Slices the string directly — never constructs a Date object so there is no
 * UTC-midnight shift of the calendar day.
 */
export function formatDateMMDD(dateStr: string): string {
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}`;
}

/**
 * "YYYY-MM-DD" → "June 18, 2026"
 * String-sliced, no Date construction, no UTC shift.
 */
export function formatDateLong(dateStr: string): string {
  const MONTHS = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  const month = parseInt(dateStr.slice(5, 7), 10) - 1;
  const day   = parseInt(dateStr.slice(8, 10), 10);
  const year  = dateStr.slice(0, 4);
  return `${MONTHS[month]} ${day}, ${year}`;
}

/** Sleep efficiency as a percent (0-100) → "94%"; absent value → "—" (a real 0 stays "0%"). */
export function formatEfficiency(percent: number | null | undefined): string {
  return percent === null || percent === undefined || Number.isNaN(percent) ? "—" : `${Math.round(percent)}%`;
}

/**
 * Sleep-debt window basis: "based on 14 nights over 19 days" when the recorded
 * nights span more than the 14-day window (gaps in the data), otherwise null.
 */
export function formatDebtBasis(nightsUsed: number, windowSpanDays: number): string | null {
  return windowSpanDays > 14 ? `based on ${nightsUsed} nights over ${windowSpanDays} days` : null;
}

/**
 * "YYYY-MM-DD" (the night's start date) → "Night of Tue, Oct 20 → Wed, Oct 21".
 * Weekday comes from local-date construction (parseLocalDate), never a UTC parse.
 */
export function formatNightRange(nightOf: string): string {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const label = (dateStr: string): string => {
    const d = parseLocalDate(dateStr);
    return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  };
  return `Night of ${label(nightOf)} → ${label(addDays(nightOf, 1))}`;
}

/**
 * 0–1 fraction → "89%" (efficiency stored as decimal in the DB).
 */
export function formatEfficiencyPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** "YYYY-MM-DD" → "Thursday 22 October". Built on parseLocalDate, so no UTC shift. */
export function formatWeekdayMonthDay(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${weekday} ${d.getDate()} ${month}`;
}

/** 431 → { hours: 7, minutes: 11 } */
export function splitDurationMins(mins: number): { hours: number; minutes: number } {
  return { hours: Math.floor(mins / 60), minutes: mins % 60 };
}
