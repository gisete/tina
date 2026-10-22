// User-facing display formatters shared across pages and chart components.

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

/**
 * 0–1 fraction → "89%" (efficiency stored as decimal in the DB).
 */
export function formatEfficiencyPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
