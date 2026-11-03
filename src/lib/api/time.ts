// Instants for API output: ISO 8601 with an explicit UTC offset, never "Z"-only
// and never toISOString() (which would drop the person's offset). Pure.

const pad = (n: number, width = 2): string => String(Math.abs(Math.trunc(n))).padStart(width, "0");

/** "+01:00" / "-05:30" / "+00:00" for an offset in seconds. */
export function formatOffset(offsetSeconds: number): string {
  const abs = Math.abs(Math.round(offsetSeconds / 60));
  const sign = offsetSeconds < 0 && abs > 0 ? "-" : "+";
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * The wall-clock reading of `epochMs` at `offsetSeconds` east of UTC, written
 * as "YYYY-MM-DDTHH:mm:ss+HH:MM". The same instant, expressed on that clock.
 */
export function formatInstantWithOffset(epochMs: number, offsetSeconds: number): string {
  const shifted = new Date(epochMs + offsetSeconds * 1000);
  const date = `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  const time = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
  return `${date}T${time}${formatOffset(offsetSeconds)}`;
}
