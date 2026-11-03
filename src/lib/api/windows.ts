// Row-window selection for multi-day reads — pure. For a day D the dashboard
// reads "the SESSION_LIMIT most recent session rows with sleepDate < D". A range
// read loads two sets once and must reproduce that window for every day exactly,
// whatever the number of rows per date.

export interface DatedRow {
  sleepDate: string;
}

/**
 * @param beforeRange  the `limit` most recent rows with sleepDate < rangeFrom, newest first
 * @param inRange      ALL rows with rangeFrom <= sleepDate < rangeTo, newest first
 * @returns the `limit` most recent rows with sleepDate < date, newest first.
 *          Exact for any date in [rangeFrom, rangeTo].
 */
export function rowsBeforeDay<T extends DatedRow>(
  beforeRange: readonly T[],
  inRange: readonly T[],
  date: string,
  limit: number,
): T[] {
  const out: T[] = [];
  for (const r of inRange) if (r.sleepDate < date) out.push(r);
  for (const r of beforeRange) out.push(r);
  return out.slice(0, limit);
}
