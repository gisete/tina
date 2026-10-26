// Shared time-axis tick generation for night-spanning charts.

export interface TimeTick {
  timestamp: number;
  xPct: number;
  anchor: "start" | "middle" | "end";
}

/**
 * Session start + whole-hour marks + session end, as percentages of the
 * window. Inner ticks near the edges are dropped so they don't collide with
 * the boundary labels.
 */
export function buildTimeTicks(startTs: number, endTs: number, offsetSeconds?: number | null): TimeTick[] {
  const spanMs = Math.max(endTs - startTs, 1);
  const pct = (ts: number) => ((ts - startTs) / spanMs) * 100;

  const ticks: TimeTick[] = [{ timestamp: startTs, xPct: 0, anchor: "start" }];
  const spanHours = spanMs / 3_600_000;
  const stepHours = Math.max(1, Math.ceil(spanHours / 4));
  let first: number;
  if (offsetSeconds === null || offsetSeconds === undefined) {
    const cursor = new Date(startTs);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(cursor.getHours() + 1);
    first = cursor.getTime();
  } else {
    // Whole hours on the stored clock (correct for half-hour zones too).
    const offMs = offsetSeconds * 1000;
    first = Math.floor((startTs + offMs) / 3_600_000) * 3_600_000 + 3_600_000 - offMs;
  }
  for (let t = first; t < endTs; t += stepHours * 3_600_000) {
    const p = pct(t);
    if (p > 8 && p < 92) ticks.push({ timestamp: t, xPct: p, anchor: "middle" });
  }
  ticks.push({ timestamp: endTs, xPct: 100, anchor: "end" });

  return ticks;
}
