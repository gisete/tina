// Pure y-domain fitting for trend charts — primitives in, primitives out.
// No React/Next/DB imports.

export interface FitDomainOptions {
  /** Padding added beyond the data on each side before rounding outward. */
  pad: number;
  /** Domain bounds are rounded outward to a multiple of this. */
  step: number;
  /**
   * The domain is widened to at least this span (rounded up to a whole number
   * of steps), split between both sides and shifted if a bound is clamped.
   */
  minSpan: number;
  /** Lower clamp; the domain never goes below it. */
  floor?: number;
  /** Upper clamp; the domain never goes above it. */
  ceil?: number;
  /** Returned when there is no data. Defaults to [0, 100]. */
  empty?: [number, number];
}

/**
 * Padded domain rounded outward to `step`, clamped to [floor, ceil], and
 * widened to `minSpan`. With { pad: 5, step: 5, minSpan: 5, floor: 0, ceil: 100 }
 * it reproduces the Sleep Score Trend's original fitted domain exactly.
 */
export function fitDomain(min: number | null, max: number | null, opts: FitDomainOptions): [number, number] {
  if (min === null || max === null) return opts.empty ?? [0, 100];
  const { pad, step, minSpan, floor, ceil } = opts;

  let lo = Math.floor((min - pad) / step) * step;
  let hi = Math.ceil((max + pad) / step) * step;
  if (floor !== undefined) lo = Math.max(floor, lo);
  if (ceil !== undefined) hi = Math.min(ceil, hi);

  const needed = Math.ceil(minSpan / step) * step;
  const short = needed - (hi - lo);
  if (short > 0) {
    const down = Math.floor(short / 2 / step) * step;
    lo -= down;
    hi += short - down;
    // A clamp that bites hands the rest to the other side.
    if (floor !== undefined && lo < floor) { hi += floor - lo; lo = floor; }
    if (ceil !== undefined && hi > ceil) { lo -= hi - ceil; hi = ceil; }
    if (floor !== undefined) lo = Math.max(floor, lo);
  }
  return [lo, hi];
}

/** The Sleep Score Trend's domain options (0..100 score, 5-point steps). */
export const SLEEP_SCORE_DOMAIN: FitDomainOptions = { pad: 5, step: 5, minSpan: 5, floor: 0, ceil: 100 };
