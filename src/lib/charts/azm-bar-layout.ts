// Pure AZM bar chart geometry — no React/Next/DB imports.
// Callers map the returned structs to SVG <rect> / <text> elements.

export interface AzmBarPoint {
  date: string;       // "YYYY-MM-DD"
  azm: number | null; // null=gap (no row), 0=worn+no-cardio, positive=cardio minutes
}

export interface AzmBarRect {
  x: number;      // left edge in plot coordinates
  y: number;      // top edge in plot coordinates (SVG: y grows downward)
  width: number;
  height: number;
  /** gap: no row for this day (absent bar). zero: worn but AZM=0 (nub). data: positive AZM. */
  kind: "gap" | "zero" | "data";
  date: string;
  azm: number | null;
  slotCenterX: number; // center of this slot in plot coords (for x-axis labels)
}

export interface AzmBarLayout {
  bars: AzmBarRect[];
  yMax: number;     // fitted y-domain ceiling (same units as azm values)
  yTicks: number[]; // nice tick values in [0, yMax]
}

const ZERO_NUB_H = 3;   // visible nub height for zero-AZM worn days (in plot units)
const GAP_RATIO  = 0.2; // fraction of each slot reserved as inter-bar padding

function niceMax(rawMax: number): number {
  if (rawMax <= 0) return 10;
  // Round up to the nearest "step", choosing step size from data magnitude.
  const step = rawMax <= 20 ? 5 : rawMax <= 60 ? 10 : rawMax <= 150 ? 25 : 50;
  return Math.ceil(rawMax / step) * step;
}

function buildYTicks(yMax: number): number[] {
  if (yMax <= 0) return [0];
  const count = yMax <= 20 ? 3 : 5;
  const step = yMax / (count - 1);
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) ticks.push(Math.round(step * i));
  return ticks;
}

/**
 * Converts an array of AZM points (one per calendar day in the active window)
 * into bar rects positioned inside a plot area of (plotWidth × plotHeight).
 *
 * Coordinate origin is top-left of the plot area. Callers offset by the y-axis
 * label margin when placing rects into the full SVG coordinate space.
 */
export function computeAzmBarLayout(
  points: AzmBarPoint[],
  plotWidth: number,
  plotHeight: number,
): AzmBarLayout {
  const n = points.length;
  if (n === 0) return { bars: [], yMax: 10, yTicks: [0, 5, 10] };

  const positives = points
    .map((p) => p.azm)
    .filter((v): v is number => v !== null && v > 0);
  const rawMax = positives.length > 0 ? Math.max(...positives) : 0;
  const yMax = niceMax(rawMax);

  const slotW = plotWidth / n;
  const barW  = slotW * (1 - GAP_RATIO);
  const padW  = slotW * GAP_RATIO;

  const bars: AzmBarRect[] = points.map((p, i) => {
    const x           = i * slotW + padW / 2;
    const slotCenterX = i * slotW + slotW / 2;

    if (p.azm === null) {
      // Gap: no bar rendered. y/height are sentinel values; component skips kind==="gap".
      return { x, y: plotHeight, width: barW, height: 0, kind: "gap", date: p.date, azm: null, slotCenterX };
    }

    if (p.azm === 0) {
      // Worn day with no cardio minutes: render a tiny nub at the baseline.
      return { x, y: plotHeight - ZERO_NUB_H, width: barW, height: ZERO_NUB_H, kind: "zero", date: p.date, azm: 0, slotCenterX };
    }

    const h = (p.azm / yMax) * plotHeight;
    return { x, y: plotHeight - h, width: barW, height: h, kind: "data", date: p.date, azm: p.azm, slotCenterX };
  });

  return { bars, yMax, yTicks: buildYTicks(yMax) };
}
