// Pure chart geometry: build SVG linearGradient stops for the overnight HR
// curve, colored by sleep stage. No React/Next/DOM imports.
//
// Calls the shared tagSamplesWithStage helper (same half-open [startMs, endMs)
// assignment used by calculateStageHr) so stage colors land at exactly the
// same clock times as the hypnogram stage transitions.

import { tagSamplesWithStage } from "@/lib/analytics/sleep/stage-hr";
import type { SleepStageInterval } from "@/lib/analytics/sleep/types";
import { STAGE_COLORS, UNSTAGED_COLOR } from "./stage-colors";
import type { SleepStageType } from "@/lib/analytics/sleep/types";

export interface GradientStop {
  /** Offset as a percentage (0–100) of the gradient's coordinate space. */
  offsetPct: number;
  color: string;
}

/**
 * Builds hard-stop SVG linearGradient offsets that color the overnight HR
 * curve by sleep stage.
 *
 * `points` must be the NightHeartLayout's sorted point array, with `xPct` in
 * [0, 100] matching the chart SVG's viewBox x-coordinate space. Because the
 * existing chart uses viewBox="0 0 100 100" (x = percentage), gradient stops
 * at `xPct` land exactly on the correct pixel without any margin compensation.
 *
 * Returns an empty array when there are no points or no timeline to match
 * against — callers fall back to the single-color stroke.
 */
export function buildStageGradientStops(
  points: ReadonlyArray<{ xPct: number; timestamp: number }>,
  timeline: ReadonlyArray<SleepStageInterval>,
): GradientStop[] {
  if (points.length === 0 || timeline.length === 0) return [];

  const tagged = tagSamplesWithStage(points, timeline);

  const colorOf = (stage: SleepStageType | null): string =>
    stage !== null ? (STAGE_COLORS[stage] ?? UNSTAGED_COLOR) : UNSTAGED_COLOR;

  const stops: GradientStop[] = [];
  stops.push({ offsetPct: 0, color: colorOf(tagged[0].stageType) });

  for (let i = 1; i < tagged.length; i++) {
    if (tagged[i].stageType !== tagged[i - 1].stageType) {
      // Hard transition: close the outgoing color at this x, open the new one.
      stops.push({ offsetPct: tagged[i].xPct, color: colorOf(tagged[i - 1].stageType) });
      stops.push({ offsetPct: tagged[i].xPct, color: colorOf(tagged[i].stageType) });
    }
  }

  stops.push({ offsetPct: 100, color: colorOf(tagged[tagged.length - 1].stageType) });

  return stops;
}
