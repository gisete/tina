// Pure geometry for a value bar with a highlighted target band — no React/Next/DB imports.

export interface TargetBar {
  /** Right edge of the axis, in percent of the night (a round number above the target). */
  axisMax: number;
  /** Fill width as % of the track. */
  fillPct: number;
  bandLeftPct: number;
  bandWidthPct: number;
}

export function buildTargetBar(value: number, targetLo: number, targetHi: number): TargetBar {
  const axisMax = Math.ceil((targetHi * 1.5) / 5) * 5;
  const pct = (v: number): number => Math.min(Math.max((v / axisMax) * 100, 0), 100);
  return {
    axisMax,
    fillPct: pct(value),
    bandLeftPct: pct(targetLo),
    bandWidthPct: pct(targetHi) - pct(targetLo),
  };
}
