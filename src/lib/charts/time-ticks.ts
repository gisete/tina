// Shared time-axis tick generation for night-spanning charts.

import { localClockMinutes, offsetForInstant } from "@/lib/dates";

export interface TimeTick {
  timestamp: number;
  xPct: number;
  anchor: "start" | "middle" | "end";
  /**
   * UTC offset (seconds) the tick's label is read on — the same nearer-end
   * rule as {@link offsetForInstant}. Null = server-local zone (offset unknown).
   */
  offsetSeconds: number | null;
}

/**
 * Session start + whole-hour marks + session end, as percentages of the
 * window. Inner ticks near the edges are dropped so they don't collide with
 * the boundary labels.
 *
 * Positions are always instant-based. With stored offsets, "whole hour" means
 * :00 of the clock the person was living in (so +5:30 zones tick on local :00,
 * not UTC-aligned), and each tick carries the offset its label is read on.
 * When start and end offsets differ (a DST change or zone crossing mid-night)
 * an inner tick that would repeat the previous label is dropped, so the axis
 * never shows the same time twice. With both offsets null the output is the
 * server-local behaviour the app always had.
 */
export function buildTimeTicks(
  startTs: number,
  endTs: number,
  startOffsetSeconds?: number | null,
  endOffsetSeconds?: number | null,
): TimeTick[] {
  const spanMs = Math.max(endTs - startTs, 1);
  const pct = (ts: number) => ((ts - startTs) / spanMs) * 100;
  const offsetAt = (ts: number): number | null =>
    offsetForInstant(ts, startTs, endTs, startOffsetSeconds, endOffsetSeconds);

  const ticks: TimeTick[] = [{ timestamp: startTs, xPct: 0, anchor: "start", offsetSeconds: offsetAt(startTs) }];
  const spanHours = spanMs / 3_600_000;
  const stepHours = Math.max(1, Math.ceil(spanHours / 4));
  const alignOffset = offsetAt(startTs);
  let first: number;
  if (alignOffset === null) {
    const cursor = new Date(startTs);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(cursor.getHours() + 1);
    first = cursor.getTime();
  } else {
    // Whole hours on the stored clock (correct for half-hour zones too).
    const offMs = alignOffset * 1000;
    first = Math.floor((startTs + offMs) / 3_600_000) * 3_600_000 + 3_600_000 - offMs;
  }
  const label = (ts: number, off: number | null): number => localClockMinutes(ts, off);
  for (let t = first; t < endTs; t += stepHours * 3_600_000) {
    const p = pct(t);
    if (p <= 8 || p >= 92) continue;
    const off = offsetAt(t);
    const prev = ticks[ticks.length - 1];
    if (off !== null && label(t, off) === label(prev.timestamp, prev.offsetSeconds)) continue;
    ticks.push({ timestamp: t, xPct: p, anchor: "middle", offsetSeconds: off });
  }
  const endOff = offsetAt(endTs);
  ticks.push({ timestamp: endTs, xPct: 100, anchor: "end", offsetSeconds: endOff });

  return ticks;
}
