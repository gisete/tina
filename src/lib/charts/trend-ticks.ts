/**
 * Selects which data-point indices should be labeled on a trend chart x-axis.
 *
 * Always includes index 0 and n-1 (first and last).
 * Distributes up to (targetCount - 2) interior labels evenly between them.
 * Returns a Set<number> so the caller can do O(1) lookup inside a tickFormatter.
 *
 * If totalPoints ≤ targetCount every index is included (show-all path).
 */
export function selectTrendTicks(totalPoints: number, targetCount: number): Set<number> {
  const out = new Set<number>();
  if (totalPoints === 0) return out;

  out.add(0);
  if (totalPoints === 1) return out;

  out.add(totalPoints - 1);

  if (totalPoints <= targetCount) {
    for (let i = 1; i < totalPoints - 1; i++) out.add(i);
    return out;
  }

  const interior = targetCount - 2;
  for (let i = 1; i <= interior; i++) {
    const idx = Math.round((i * (totalPoints - 1)) / (interior + 1));
    out.add(idx);
  }

  return out;
}
