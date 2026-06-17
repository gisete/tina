// Single source of truth for sleep stage colors.
// Imported by both hypnogram-chart.tsx and night-heart-stage.ts so a color
// means the same thing on every chart in the app.

import type { SleepStageType } from "@/lib/analytics/sleep/types";

export const STAGE_COLORS: Record<SleepStageType, string> = {
  deep:  "#1e1b4b", // indigo-950  — deep midnight navy
  light: "#6366f1", // indigo-500  — periwinkle
  rem:   "#8b5cf6", // violet-500  — lavender purple
  awake: "#d97706", // amber-600   — soft amber gold
};

/** HR samples outside every stage interval (gaps, pre-onset, post-wake). */
export const UNSTAGED_COLOR = "#9ca3af"; // gray-400
