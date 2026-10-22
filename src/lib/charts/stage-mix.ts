// Pure stage-bar geometry — no React/Next/DB imports. Callers map the ordered
// list to flex segments (flex-grow = minutes), so widths are proportional.

export type MixStage = "deep" | "light" | "rem" | "awake";

export interface StageMinutes {
  deepMins: number;
  lightMins: number;
  remMins: number;
  awakeMins: number;
}

export interface StageMixSegment {
  stage: MixStage;
  minutes: number;
  /** flex-grow weight; equal to minutes, so segment width is proportional. */
  grow: number;
}

/** Ordered deep, light, rem, awake; zero-minute (or invalid) stages are dropped. */
export function buildStageMix(input: StageMinutes): StageMixSegment[] {
  const ordered: Array<[MixStage, number]> = [
    ["deep", input.deepMins],
    ["light", input.lightMins],
    ["rem", input.remMins],
    ["awake", input.awakeMins],
  ];
  return ordered
    .filter(([, minutes]) => Number.isFinite(minutes) && minutes > 0)
    .map(([stage, minutes]) => ({ stage, minutes, grow: minutes }));
}
