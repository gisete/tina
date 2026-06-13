// Shared pure utilities for sleep analytics engines.
// Zero framework imports — plain TypeScript math only.

/** Returns the median of an array of numbers. Returns 0 for an empty array. */
export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Downsamples a high-frequency HR sample stream to 1-minute bins using the
 * median bpm within each bucket. Callers that expect ~1/min data but receive
 * raw 2.5 Hz samples (12 000+ per night) call this first to eliminate
 * sub-minute noise without losing the minute-level shape of the HR trace.
 *
 * The output is sorted ascending by timestamp with one entry per calendar
 * minute (UTC bucket floor). Duplicate timestamps in the input are folded
 * into the same bucket's median rather than producing duplicate output rows.
 */
export function downsampleToMinuteBins(
  samples: { timestamp: number; bpm: number }[]
): { timestamp: number; bpm: number }[] {
  const BIN_MS = 60_000;
  const rawSorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const bins = new Map<number, number[]>();
  for (const s of rawSorted) {
    const bin = Math.floor(s.timestamp / BIN_MS) * BIN_MS;
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin)!.push(s.bpm);
  }
  return Array.from(bins.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, bpms]) => ({ timestamp: ts, bpm: medianOf(bpms) }));
}
