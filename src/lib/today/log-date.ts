import { addDays } from "@/lib/dates";
import type { Validated } from "./validate";

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** The only dates that may be logged: today and yesterday (local calendar). */
export function loggableDates(today: string): [string, string] {
  return [today, addDays(today, -1)];
}

/**
 * Validates a client-supplied "YYYY-MM-DD" against the logging window. The
 * format check runs first so malformed input never reaches date arithmetic.
 */
export function validateLogDate(raw: unknown, today: string): Validated<string> {
  if (typeof raw !== "string" || !DATE_FORMAT.test(raw)) {
    return { ok: false, error: "Invalid date" };
  }
  return loggableDates(today).includes(raw)
    ? { ok: true, value: raw }
    : { ok: false, error: "Only today and yesterday can be logged" };
}

/**
 * True when the sync clock is missing or older than `staleAfterHours`.
 * Mirrors the staleness rule loadPageData applies on the sleep page.
 */
export function isSyncStale(lastSyncedAtMs: number | null, nowMs: number, staleAfterHours: number): boolean {
  return lastSyncedAtMs === null || nowMs - lastSyncedAtMs > staleAfterHours * 3_600_000;
}

/** Hours before the sync clock counts as stale — matches STALE_AFTER_HOURS in the sync action. */
export const TODAY_STALE_AFTER_HOURS = 6;
