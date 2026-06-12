// Pure layout math for the Fitbit-style sleep-stage timeline.
//
// Everything here is expressed in percentages of the session width so the
// chart can render fluid-width without resize observers. No DOM, no React —
// feed it intervals and assert on the returned geometry in unit tests.

import type { SleepStageInterval, SleepStageType } from "@/lib/analytics/sleep";
import { buildTimeTicks, type TimeTick } from "./time-ticks";

/** Lane order top→bottom, matching the Fitbit timeline. */
export const LANES: Array<{ stage: SleepStageType; label: string }> = [
  { stage: "awake", label: "Awake" },
  { stage: "rem",   label: "REM" },
  { stage: "light", label: "Light" },
  { stage: "deep",  label: "Deep" },
];

export const LANE_INDEX: Record<SleepStageType, number> = {
  awake: 0,
  rem:   1,
  light: 2,
  deep:  3,
};

// Segments narrower than this (% of session width) are clamped up so brief
// interruptions stay visible as thin ticks instead of vanishing entirely.
const MIN_SEG_PCT = 0.45;

export interface HypnogramSegment {
  interval: SleepStageInterval;
  laneIndex: number;
  xPct: number;
  widthPct: number;
  /** Fully round this end — it marks the session boundary (onset / wake). */
  roundLeft: boolean;
  roundRight: boolean;
}

export interface HypnogramConnector {
  xPct: number;
  fromLane: number;
  toLane: number;
}

export interface HypnogramLayout {
  segments: HypnogramSegment[];
  connectors: HypnogramConnector[];
  ticks: TimeTick[];
  stageTotalsMs: Record<SleepStageType, number>;
}

export function buildHypnogramLayout(
  timeline: SleepStageInterval[],
  sessionStart: string,
  sessionEnd: string
): HypnogramLayout {
  const startTs = new Date(sessionStart).getTime();
  const endTs   = new Date(sessionEnd).getTime();
  const spanMs  = Math.max(endTs - startTs, 1);

  const pct = (ts: number) => ((ts - startTs) / spanMs) * 100;

  const intervals = [...timeline].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const stageTotalsMs: Record<SleepStageType, number> = { awake: 0, rem: 0, light: 0, deep: 0 };
  for (const iv of intervals) stageTotalsMs[iv.stageType] += iv.durationMs;

  const segments: HypnogramSegment[] = intervals.map((iv, k) => {
    const xPct = pct(new Date(iv.startTime).getTime());
    const widthPct = Math.min(
      Math.max(pct(new Date(iv.endTime).getTime()) - xPct, MIN_SEG_PCT),
      100 - xPct
    );
    return {
      interval: iv,
      laneIndex: LANE_INDEX[iv.stageType],
      xPct,
      widthPct,
      roundLeft: k === 0,
      roundRight: k === intervals.length - 1,
    };
  });

  const connectors: HypnogramConnector[] = [];
  for (let k = 0; k < intervals.length - 1; k++) {
    const cur = intervals[k];
    const next = intervals[k + 1];
    if (next.stageType === cur.stageType) continue;
    connectors.push({
      xPct: pct(new Date(next.startTime).getTime()),
      fromLane: LANE_INDEX[cur.stageType],
      toLane: LANE_INDEX[next.stageType],
    });
  }

  return { segments, connectors, ticks: buildTimeTicks(startTs, endTs), stageTotalsMs };
}
