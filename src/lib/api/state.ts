// Payload of GET /api/v1/state — types and builder. Pure.

import { MIN_CIRCADIAN_NIGHTS, type CircadianVariance, type SleepDebt } from "@/lib/analytics/sleep";
import { derived, unavailable, type MetricValue } from "./metric";
import { formatInstantWithOffset } from "./time";

export interface StateData {
  sleepDebt: {
    cumulativeHours: MetricValue;
    severity: "high" | "moderate" | "optimal" | null;
    /** Recorded nights the figure is based on (not calendar days). */
    nightsUsed: number;
    windowSpanDays: number;
    targetHoursPerNight: number;
  };
  circadianVariance: {
    /** Standard deviation of bedtime, minutes. Unavailable below the minimum number of recorded nights. */
    bedtimeStdDevMinutes: MetricValue;
    averageBedtimeMinutesFromMidnight: MetricValue;
    status: "stable" | "variable" | "erratic" | null;
    nights: number;
  };
  sync: {
    /** Instant of the last successful recent-window sync, or null if never. */
    lastSyncedAt: string | null;
    /** Latest date up to which synced coverage is contiguous; null = not tracked. */
    syncedThrough: string | null;
    google: {
      /** A Google account is linked. */
      linked: boolean;
      /** A refresh token is stored, so sign-in can renew without the person. */
      hasRefreshToken: boolean;
      /** Stored access-token expiry, or null. Expiry alone is not a failure: it renews on use. */
      accessTokenExpiresAt: string | null;
      /** Honest limit: failures are not persisted, so "valid" cannot be confirmed without calling Google. */
      note: string;
    };
  };
}

const GOOGLE_AUTH_NOTE =
  "Auth failures are not persisted; whether Google would accept the stored refresh token is only known when a sync runs.";

export interface StateInput {
  debt: SleepDebt | null;
  variance: CircadianVariance | null;
  debtTargetHours: number;
  lastSyncedAtMs: number | null;
  syncedThrough: string | null;
  serverOffsetSeconds: number;
  google: { linked: boolean; hasRefreshToken: boolean; accessTokenExpiresAtSec: number | null };
}

export function buildStateData(i: StateInput): StateData {
  const v = i.variance;
  const varianceReady = v !== null && v.nights >= MIN_CIRCADIAN_NIGHTS;
  return {
    sleepDebt: {
      cumulativeHours: i.debt ? derived(i.debt.cumulativeDebtHours, "hours") : unavailable("insufficient_data"),
      severity: i.debt?.severity ?? null,
      nightsUsed: i.debt?.nightsUsed ?? 0,
      windowSpanDays: i.debt?.windowSpanDays ?? 0,
      targetHoursPerNight: i.debtTargetHours,
    },
    circadianVariance: {
      bedtimeStdDevMinutes: varianceReady ? derived(v.standardDeviationMinutes, "min") : unavailable("insufficient_data"),
      averageBedtimeMinutesFromMidnight: varianceReady ? derived(v.averageBedtimeMinutesFromMidnight, "min") : unavailable("insufficient_data"),
      status: varianceReady ? v.status : null,
      nights: v?.nights ?? 0,
    },
    sync: {
      lastSyncedAt: i.lastSyncedAtMs === null ? null : formatInstantWithOffset(i.lastSyncedAtMs, i.serverOffsetSeconds),
      syncedThrough: i.syncedThrough,
      google: {
        linked: i.google.linked,
        hasRefreshToken: i.google.hasRefreshToken,
        accessTokenExpiresAt:
          i.google.accessTokenExpiresAtSec === null
            ? null
            : formatInstantWithOffset(i.google.accessTokenExpiresAtSec * 1000, i.serverOffsetSeconds),
        note: GOOGLE_AUTH_NOTE,
      },
    },
  };
}
