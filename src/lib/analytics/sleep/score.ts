/**
 * Clinical efficiency at or above this level earns full credit. Nobody is
 * asleep for 100% of time in bed, so without this benchmark the composite
 * could never reach 100 — 95%+ is "excellent" in sleep-medicine terms.
 */
const EXCELLENT_EFFICIENCY = 0.95;

export function calculateHolisticSleepScore(
  totalSleepMs: number,
  timeInBedMs: number,
  deepContinuityScore: number,
  /**
   * Optional 0-100 overnight cardiac recovery score (see night-heart.ts).
   * When provided, the weighting becomes 40% volume / 30% efficiency /
   * 20% continuity / 10% cardiac; when null, the original 45/35/20 applies
   * so nights without heart data are scored on the same scale.
   */
  cardiacRecoveryScore: number | null = null,
  targetSleepMs: number = 8 * 3600 * 1000 // 8 Hour Baseline
): number {
  if (timeInBedMs <= 0) return 0;

  // 1. Clinical Efficiency: (Total Sleep / Time in Bed), normalized so that
  // hitting the excellence benchmark counts as perfect.
  // Penalizes tossing and turning.
  const baseEfficiency = Math.min((totalSleepMs / timeInBedMs) / EXCELLENT_EFFICIENCY, 1.0);

  // 2. Volume Sufficiency: (Total Sleep / Target Goal)
  // Heavily penalizes short nights.
  const volumeRatio = Math.min(totalSleepMs / targetSleepMs, 1.0);

  // 3. Restorative Quality: (Deep Sleep Continuity)
  // Rewards 30m+ anchor blocks, penalizes micro-interruptions.
  const qualityRatio = deepContinuityScore / 100;

  // Weighted Distribution:
  // with heart data:    40% Volume | 30% Efficiency | 20% Quality | 10% Cardiac
  // without heart data: 45% Volume | 35% Efficiency | 20% Quality
  const score = cardiacRecoveryScore !== null
    ? (volumeRatio * 0.40) + (baseEfficiency * 0.30) + (qualityRatio * 0.20) + ((cardiacRecoveryScore / 100) * 0.10)
    : (volumeRatio * 0.45) + (baseEfficiency * 0.35) + (qualityRatio * 0.20);

  return Math.round(score * 100);
}
