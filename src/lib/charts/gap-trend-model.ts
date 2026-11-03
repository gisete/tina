// Pure data model for GapTrendChart — primitives in, primitives out.
// No React/Next/DB imports. The baseline is a display overlay only: it joins
// the y-domain (so the dashed line is never clipped) but never feeds the gap
// model, bridges, isolated dots or absent ticks, which come from the actual
// values alone.

import { fitDomain, type FitDomainOptions } from "./trend-domain";
import { absenceLabel, absenceText, type AbsenceContext } from "./data-gaps";

/** Fitted y-domain over the actual values AND the baseline values together. */
export function fitTrendDomain(
  values: readonly (number | null)[],
  baseline: readonly (number | null)[] | undefined,
  opts: FitDomainOptions,
): [number, number] {
  const all: number[] = [];
  for (const v of values) if (v !== null) all.push(v);
  if (baseline) for (const b of baseline) if (b !== null && b !== undefined) all.push(b);
  if (all.length === 0) return fitDomain(null, null, opts);
  return fitDomain(Math.min(...all), Math.max(...all), opts);
}

export interface TrendRow {
  date: string;
  displayDate: string;
  value: number | null;
  baseline: number | null;
  absentTick: number | null;
  isolatedDot: number | null;
  pending: boolean;
  /** bridge0, bridge1, … */
  [bridgeKey: string]: number | string | boolean | null;
}

export interface BuildRowsInput {
  dates: readonly string[];
  displayDates: readonly string[];
  values: readonly (number | null)[];
  baseline?: readonly (number | null)[];
  pendingIdx: number | null;
  isolated: ReadonlySet<number>;
  domainMin: number;
  bridgeValues: readonly (readonly (number | null)[])[];
}

export function buildTrendRows(input: BuildRowsInput): TrendRow[] {
  const { dates, displayDates, values, baseline, pendingIdx, isolated, domainMin, bridgeValues } = input;
  return values.map((value, i) => {
    const row: TrendRow = {
      date: dates[i],
      displayDate: displayDates[i],
      value,
      baseline: baseline ? (baseline[i] ?? null) : null,
      // Tick anchor: only absent (non-pending) days, pinned to the axis floor.
      absentTick: value === null && i !== pendingIdx ? domainMin : null,
      // Anchor dot only for a score with no solid-line neighbour.
      isolatedDot: isolated.has(i) ? value : null,
      pending: i === pendingIdx,
    };
    bridgeValues.forEach((vals, k) => { row[`bridge${k}`] = vals[i]; });
    return row;
  });
}

export interface TooltipLines {
  /** Actual series line: the value, or the absence text. */
  text: string;
  /** Baseline line, or null when there is no baseline for that day. Shown even on absent days. */
  baseline: string | null;
}

export function tooltipLines(
  row: Pick<TrendRow, "date" | "value" | "baseline">,
  seriesLabel: string,
  unit: string,
  ctx: AbsenceContext,
): TooltipLines {
  const fmt = (v: number) => (unit ? `${v} ${unit}` : `${v}`);
  return {
    text: row.value !== null ? `${seriesLabel} : ${fmt(row.value)}` : absenceText(absenceLabel(row.date, ctx)),
    baseline: row.baseline !== null ? `Baseline : ${fmt(row.baseline)}` : null,
  };
}
