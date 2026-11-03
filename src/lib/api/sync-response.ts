// Payload of POST /api/v1/sync — type only. Pure.

import type { ApiSyncStatus } from "./sync-loop";

export interface SyncResponseData {
  status: ApiSyncStatus;
  /** Catch-up steps that did work in this call. */
  stepsRun: number;
  /** Latest date up to which synced coverage is contiguous; null = not tracked. */
  syncedThrough: string | null;
  /** Instant of the last successful recent-window sync, or null. */
  lastSyncedAt: string | null;
  /** Present when status is "error". */
  message?: string;
}
