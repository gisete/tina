// Query-parameter parsing for /api/v1 — pure. Calendar dates are local "YYYY-MM-DD".

import { addDays, diffDays } from "@/lib/dates";
import { MAX_RANGE_DAYS, type ApiErrorCode } from "./envelope";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: ApiErrorCode; message: string };

/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-30). */
export function isCivilDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** `date` for /day: absent → today. */
export function parseDayParams(raw: { date: string | null }, today: string): ParseResult<{ date: string }> {
  if (raw.date === null || raw.date === "") return { ok: true, value: { date: today } };
  if (!isCivilDate(raw.date)) {
    return { ok: false, code: "invalid_parameter", message: "date must be a real calendar date written YYYY-MM-DD." };
  }
  return { ok: true, value: { date: raw.date } };
}

/** `from`/`to` for /days: both required, from <= to, at most MAX_RANGE_DAYS days inclusive. */
export function parseRangeParams(raw: { from: string | null; to: string | null }): ParseResult<{ from: string; to: string }> {
  const { from, to } = raw;
  if (!from || !to || !isCivilDate(from) || !isCivilDate(to)) {
    return { ok: false, code: "invalid_parameter", message: "from and to are required and must be real calendar dates written YYYY-MM-DD." };
  }
  if (from > to) return { ok: false, code: "invalid_parameter", message: "from must not be after to." };
  const days = diffDays(from, to) + 1;
  if (days > MAX_RANGE_DAYS) {
    return {
      ok: false,
      code: "range_too_large",
      message: `The range spans ${days} days; the maximum is ${MAX_RANGE_DAYS}. Latest allowed to for this from: ${addDays(from, MAX_RANGE_DAYS - 1)}.`,
    };
  }
  return { ok: true, value: { from, to } };
}

/** Every date from `from` to `to` inclusive, ascending. */
export function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
