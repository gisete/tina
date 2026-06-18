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

// ---------------------------------------------------------------------------
// Breakdown types — returned by calculateSleepScoreBreakdown.
// ---------------------------------------------------------------------------

export type SleepScoreComponentKey = "volume" | "efficiency" | "continuity" | "disruption" | "cardiac";

export type SleepScoreComponent = {
  key: SleepScoreComponentKey;
  /** false when the component was absent and its weight redistributed. */
  present: boolean;
  /** 0–100 sub-score for this night; null when absent. */
  subScore: number | null;
  /** Effective weight as a fraction 0–1, after redistribution; 0 when absent. */
  weight: number;
  /** subScore * weight — points contributed to the final score; 0 when absent. */
  contribution: number;
};

export type SleepScoreBreakdown = {
  score: number;
  components: SleepScoreComponent[];
};

/**
 * Computes the holistic sleep score with a full per-component breakdown.
 * The five components always appear in the returned array; absent ones have
 * `present: false` and `weight: 0 / contribution: 0`.
 *
 * The present weights sum to 1; the present contributions sum to `score`
 * (within ±0.5 due to rounding).
 */
export function calculateSleepScoreBreakdown(
  totalSleepMs: number,
  timeInBedMs: number,
  deepContinuityScore: number,
  disruptionIndex: number,
  cardiacScore: number | null = null,
  targetSleepMs: number = 8 * 3_600_000
): SleepScoreBreakdown {
  if (timeInBedMs <= 0) {
    return {
      score: 0,
      components: [
        { key: "volume",      present: false, subScore: null, weight: 0, contribution: 0 },
        { key: "efficiency",  present: false, subScore: null, weight: 0, contribution: 0 },
        { key: "continuity",  present: false, subScore: null, weight: 0, contribution: 0 },
        { key: "disruption",  present: false, subScore: null, weight: 0, contribution: 0 },
        { key: "cardiac",     present: false, subScore: null, weight: 0, contribution: 0 },
      ],
    };
  }

  const volumeScore     = Math.min(totalSleepMs / targetSleepMs, 1.0) * 100;
  const efficiencyScore = Math.min(rawSleepEfficiency(totalSleepMs, timeInBedMs) / EXCELLENT_EFFICIENCY, 1.0) * 100;

  const raw: Array<{ key: SleepScoreComponentKey; subScore: number; nominalWeight: number }> = [
    { key: "volume",      subScore: volumeScore,          nominalWeight: W_VOLUME },
    { key: "efficiency",  subScore: efficiencyScore,      nominalWeight: W_EFFICIENCY },
    { key: "continuity",  subScore: deepContinuityScore,  nominalWeight: W_CONTINUITY },
    { key: "disruption",  subScore: disruptionIndex,      nominalWeight: W_DISRUPTION },
  ];
  if (cardiacScore !== null) {
    raw.push({ key: "cardiac", subScore: cardiacScore, nominalWeight: W_CARDIAC });
  }

  const totalWeight = raw.reduce((sum, c) => sum + c.nominalWeight, 0);

  const presentComponents: SleepScoreComponent[] = raw.map((c) => {
    const weight       = c.nominalWeight / totalWeight;
    const contribution = c.subScore * weight;
    return { key: c.key, present: true, subScore: c.subScore, weight, contribution };
  });

  const score = Math.round(presentComponents.reduce((sum, c) => sum + c.contribution, 0));

  const components: SleepScoreComponent[] = [...presentComponents];
  if (cardiacScore === null) {
    components.push({ key: "cardiac", present: false, subScore: null, weight: 0, contribution: 0 });
  }

  return { score, components };
}

/**
 * Thin wrapper — returns only the composite score for the three existing call
 * sites that don't need the per-component breakdown. Signature is unchanged.
 */
export function calculateHolisticSleepScore(
  totalSleepMs: number,
  timeInBedMs: number,
  deepContinuityScore: number,
  disruptionIndex: number,
  cardiacScore: number | null = null,
  targetSleepMs: number = 8 * 3_600_000
): number {
  return calculateSleepScoreBreakdown(
    totalSleepMs,
    timeInBedMs,
    deepContinuityScore,
    disruptionIndex,
    cardiacScore,
    targetSleepMs,
  ).score;
}
