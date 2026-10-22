// Totals shown on the Sleep page's number cards, from primitives only.

import { liveSleepEfficiency } from "./score";

export interface NightTotals {
  asleepMins: number;
  inBedMins: number;
  /** Time in bed not spent asleep. */
  awakeInBedMins: number;
  /** Live 0-1 efficiency (score-engine definition); null with no time in bed. */
  efficiency: number | null;
}

export function summarizeNightTotals(totalSleepMs: number, startTime: string, endTime: string): NightTotals {
  const inBedMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const asleepMins = Math.round(totalSleepMs / 60000);
  const inBedMins = Math.max(0, Math.round(inBedMs / 60000));
  return {
    asleepMins,
    inBedMins,
    awakeInBedMins: Math.max(0, inBedMins - asleepMins),
    efficiency: liveSleepEfficiency(totalSleepMs, inBedMs),
  };
}
