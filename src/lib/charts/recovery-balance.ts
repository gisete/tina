// Pure layout geometry for the Recovery vs Normal z-score chart.
// Primitives in, JSON-safe primitives out — no React, no DOM imports.
// Component maps the returned structs to SVG/DOM; no coordinate math lives there.

import { buildGapModel, isolatedPresentIndices } from "./data-gaps";
import { selectTrendTicks } from "./trend-ticks";

export interface ZPoint {
  /** Horizontal fraction of the plot area, 0 = left edge, 1 = right edge. */
  xFrac: number;
  /** Vertical fraction, 0 = top edge, 1 = bottom edge. */
  yFrac: number;
}

/** A dotted connector between the end of one run and the start of the next in ONE series. */
export interface ZBridge {
  from: ZPoint;
  to: ZPoint;
  /** Data-point indices of the two real points it joins. */
  fromIndex: number;
  toIndex: number;
}

export interface RecoveryBalanceTick {
  /** Raw z-score value (integer). */
  z: number;
  /** Vertical fraction for this tick line/label. */
  yFrac: number;
}

export interface RecoveryBalanceGeometry {
  /** Symmetric domain lower bound (negative). */
  yMin: number;
  /** Symmetric domain upper bound (positive). */
  yMax: number;
  /** Vertical fraction for z=0; always 0.5 when domain is symmetric. */
  zeroYFrac: number;
  /** Integer z-score ticks from yMin to yMax (inclusive). */
  yTicks: RecoveryBalanceTick[];
  /** Which data-point indices receive a visible x-axis label. */
  xTickIndices: Set<number>;
  /** Horizontal fraction for each data-point index (parallel to input arrays). */
  xFracs: number[];
  /**
   * Contiguous non-null runs of the RHR z-series. Null values produce gaps —
   * each sub-array is rendered as a separate polyline path.
   */
  rhrSegments: ZPoint[][];
  /** Contiguous non-null runs of the HRV z-series. */
  hrvSegments: ZPoint[][];
  /** One entry per non-null RHR point — used for window-aware ring markers. */
  rhrMarkers: ZPoint[];
  /** One entry per non-null HRV point. */
  hrvMarkers: ZPoint[];
  /**
   * Dotted bridges across interior gaps of the RHR z-series: last real point
   * before the gap to first real point after it. Never at the window edges.
   */
  rhrBridges: ZBridge[];
  hrvBridges: ZBridge[];
  /**
   * Present points of the RHR z-series with no present neighbour (window edges
   * count as absent): the ones a line would draw as nothing. Used only by views
   * that draw no per-point markers.
   */
  rhrIsolated: ZPoint[];
  hrvIsolated: ZPoint[];
  /**
   * Data-point indices where BOTH series have no value (the only days that get
   * a baseline tick, since one metric alone being absent is already visible as
   * a bridge or a run break). A series with no baseline is all-null, so it
   * leaves the decision to the other one.
   */
  bothAbsentIndices: number[];
}

const TICK_TARGET = 7;
// Minimum symmetric bound — prevents a near-flat series from collapsing onto the zero line.
const MIN_BOUND = 2;

/**
 * Builds all coordinate geometry for the Recovery vs Normal chart.
 *
 * Both series must be the same length (parallel arrays, one entry per date in
 * the displayed window). The returned fractions are dimensionless [0, 1] so
 * the component can scale them to any pixel height/width without recomputing.
 */
export function buildRecoveryBalanceGeometry(
  rhrPoints: (number | null)[],
  hrvPoints: (number | null)[],
): RecoveryBalanceGeometry {
  const n = rhrPoints.length;

  // 1. Symmetric y-domain centered on zero.
  //    Fit to max absolute z across both series, pad by 0.5, round up to the
  //    nearest integer, then clamp to MIN_BOUND so a near-flat series never
  //    collapses onto the zero line.
  const allZ = [...rhrPoints, ...hrvPoints].filter((v): v is number => v !== null);
  const maxAbs = allZ.length > 0 ? Math.max(...allZ.map(Math.abs)) : 0;
  const bound = Math.max(Math.ceil(maxAbs + 0.5), MIN_BOUND);
  const yMax = bound;
  const yMin = -bound;
  const span = yMax - yMin;

  const toYFrac = (z: number): number => (yMax - z) / span;

  // 2. Integer y-ticks from yMin to yMax.
  const yTicks: RecoveryBalanceTick[] = [];
  for (let z = yMin; z <= yMax; z++) {
    yTicks.push({ z, yFrac: toYFrac(z) });
  }

  // 3. Uniform x positions: index 0 → left edge (0), index n-1 → right edge (1).
  const xFracs = Array.from({ length: n }, (_, i) => (n <= 1 ? 0.5 : i / (n - 1)));
  const xTickIndices = selectTrendTicks(n, TICK_TARGET);

  // 4. Split each series into contiguous non-null segments (gaps break the line)
  //    and collect all non-null points as markers.
  const buildSegments = (points: (number | null)[]): ZPoint[][] => {
    const segments: ZPoint[][] = [];
    let current: ZPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const v = points[i];
      if (v === null) {
        if (current.length > 0) {
          segments.push(current);
          current = [];
        }
      } else {
        current.push({ xFrac: xFracs[i], yFrac: toYFrac(v) });
      }
    }
    if (current.length > 0) segments.push(current);
    return segments;
  };

  const buildMarkers = (points: (number | null)[]): ZPoint[] =>
    points
      .map((v, i) => (v !== null ? { xFrac: xFracs[i], yFrac: toYFrac(v) } : null))
      .filter((m): m is ZPoint => m !== null);

  const buildBridges = (points: (number | null)[]): ZBridge[] =>
    buildGapModel(points).bridges.map((b) => ({
      from: { xFrac: xFracs[b.fromIndex], yFrac: toYFrac(points[b.fromIndex] as number) },
      to: { xFrac: xFracs[b.toIndex], yFrac: toYFrac(points[b.toIndex] as number) },
      fromIndex: b.fromIndex,
      toIndex: b.toIndex,
    }));

  const buildIsolated = (points: (number | null)[]): ZPoint[] =>
    isolatedPresentIndices(points).map((i) => ({ xFrac: xFracs[i], yFrac: toYFrac(points[i] as number) }));

  const bothAbsentIndices = rhrPoints.flatMap((v, i) => (v === null && hrvPoints[i] === null ? [i] : []));

  return {
    yMin,
    yMax,
    zeroYFrac: toYFrac(0),
    yTicks,
    xTickIndices,
    xFracs,
    rhrSegments: buildSegments(rhrPoints),
    hrvSegments: buildSegments(hrvPoints),
    rhrMarkers: buildMarkers(rhrPoints),
    hrvMarkers: buildMarkers(hrvPoints),
    rhrBridges: buildBridges(rhrPoints),
    hrvBridges: buildBridges(hrvPoints),
    rhrIsolated: buildIsolated(rhrPoints),
    hrvIsolated: buildIsolated(hrvPoints),
    bothAbsentIndices,
  };
}
