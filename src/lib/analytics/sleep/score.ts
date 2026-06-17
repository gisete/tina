// Holistic sleep score (0-100) — weighted composite of five components.
//
// Full-data weighting (all five present):
//   30% Volume sufficiency (total sleep vs 8h target)
//   15% Clinical efficiency (sleep / time in bed, benchmarked at 95%)
//   20% Deep-sleep continuity
//   20% Disruption index (awakenings + HR-derived restless events)
//   15% Cardiac recovery (intra-night strain preferred; daily RHR/HRV fallback)
//
// When a component is unavailable (null), its weight is redistributed across
// the remaining components proportionally, so a 4-component night is scored
// on the same 0-100 scale as a 5-component night. This means volume + efficiency
// alone cannot exceed ~63 (30+15 / (30+15+20+20) = 45/85 × 100) — a long-
// but-fragmented night with no cardiac data still can't reach 90+.

// ---------------------------------------------------------------------------
// Named weight constants — must sum to 1.0 for the full-data case.
// ---------------------------------------------------------------------------
const W_VOLUME     = 0.30;
const W_EFFICIENCY = 0.15;
const W_CONTINUITY = 0.20;
const W_DISRUPTION = 0.20;
const W_CARDIAC    = 0.15;

/**
 * Clinical efficiency at or above this level earns full credit. Nobody is
 * asleep 100% of time in bed, so without this benchmark the composite could
 * never reach 100. 95%+ is "excellent" in sleep-medicine terms.
 */
const EXCELLENT_EFFICIENCY = 0.95;

/**
 * Raw sleep efficiency: the fraction of time in bed actually spent asleep.
 * Returns a value in [0, 1]; clamped so anomalous data never exceeds 1.
 *
 * This is the SINGLE definition of efficiency used everywhere in Tina —
 * the Efficiency Trend shows it as a percentage (× 100), and the holistic
 * score scales it against EXCELLENT_EFFICIENCY before weighting.
 *
 * Do NOT use sleep_sessions.efficiency_score (Google's minutesAsleep /
 * minutesInSleepPeriod) for any display or scoring purpose — that value is
 * a different denominator, frozen at sync time, and kept only for legacy
 * reasons pending a column cleanup.
 */
export function rawSleepEfficiency(totalSleepMs: number, timeInBedMs: number): number {
  if (timeInBedMs <= 0) return 0;
  return Math.min(totalSleepMs / timeInBedMs, 1);
}

/**
 * Computes a 0-100 holistic sleep quality score.
 *
 * When `cardiacScore` is null the cardiac weight (15%) is redistributed
 * proportionally across the remaining four components, so every call produces
 * a comparable score regardless of data availability.
 *
 * @param disruptionIndex 0-100 from the restlessness engine (100 = no disruption).
 * @param cardiacScore    0-100 cardiac recovery; null when HR data is absent.
 */
export function calculateHolisticSleepScore(
  totalSleepMs: number,
  timeInBedMs: number,
  deepContinuityScore: number,
  disruptionIndex: number,
  cardiacScore: number | null = null,
  targetSleepMs: number = 8 * 3_600_000
): number {
  if (timeInBedMs <= 0) return 0;

  const volumeScore     = Math.min(totalSleepMs / targetSleepMs, 1.0) * 100;
  const efficiencyScore = Math.min(rawSleepEfficiency(totalSleepMs, timeInBedMs) / EXCELLENT_EFFICIENCY, 1.0) * 100;

  const components: Array<{ score: number; weight: number }> = [
    { score: volumeScore,       weight: W_VOLUME },
    { score: efficiencyScore,   weight: W_EFFICIENCY },
    { score: deepContinuityScore, weight: W_CONTINUITY },
    { score: disruptionIndex,   weight: W_DISRUPTION },
  ];
  if (cardiacScore !== null) {
    components.push({ score: cardiacScore, weight: W_CARDIAC });
  }

  // Normalize so missing components don't deflate the total — their weight
  // is spread across the rest in the same proportions.
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const rawScore = components.reduce(
    (sum, c) => sum + (c.score / 100) * (c.weight / totalWeight),
    0
  );

  return Math.round(rawScore * 100);
}
