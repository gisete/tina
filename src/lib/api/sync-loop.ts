// The loop behind POST /api/v1/sync — pure orchestration with injected I/O so it
// can be fixture-tested with stubs. No React/Next/DB imports. One step = one unit
// of catch-up work (see src/lib/sync/step.ts); the real runner holds the sync lock.

import type { SyncStepResult } from "@/lib/sync/step-types";

export const MAX_API_SYNC_STEPS = 8;
export const MAX_API_SYNC_MS = 45_000;

export type ApiSyncStatus = "fresh" | "synced" | "pending" | "auth_required" | "error";

/** Every status except "error" carries no message; "error" always does. */
export type ApiSyncOutcome =
  | { status: Exclude<ApiSyncStatus, "error">; stepsRun: number }
  | { status: "error"; stepsRun: number; message: string };

export interface SyncLoopDeps {
  /** `force` is true for the first call of a forced loop and false for every other call. */
  runStep: (opts: { force: boolean }) => Promise<SyncStepResult>;
  nowMs: () => number;
}

export interface SyncLoopOptions {
  /** Force the FIRST step (the recent window, regardless of staleness). Later steps always run unforced. */
  force: boolean;
}

/**
 * Runs steps until nothing is due, the lock is held, an error occurs, or the
 * step/time cap is reached. A step that returned "running" did real work.
 *
 * - idle on the first step → "fresh" (nothing due; the step made no Google call)
 * - idle after work → "synced"
 * - a forced call is never "fresh": idle ends it as "synced". Only the first step is forced; a forced
 *   step always picks the recent window, so forcing every step would re-sync it until the cap.
 *   Later steps run the normal plan (gap chunks, a recent-window pass if the cursor lags today, then idle).
 * - step/time cap reached → "pending" (more work may remain; calling again is cheap and returns "fresh" if not)
 * - lock held by another sync → "pending"
 */
export async function runSyncLoop(
  deps: SyncLoopDeps,
  options: SyncLoopOptions,
  limits: { maxSteps: number; maxMs: number } = { maxSteps: MAX_API_SYNC_STEPS, maxMs: MAX_API_SYNC_MS },
): Promise<ApiSyncOutcome> {
  const startedAt = deps.nowMs();
  let stepsRun = 0;
  let firstCall = true;

  while (true) {
    if (stepsRun >= limits.maxSteps || deps.nowMs() - startedAt >= limits.maxMs) {
      return { status: "pending", stepsRun };
    }
    const force = options.force && firstCall;
    firstCall = false;
    const result = await deps.runStep({ force });
    switch (result.kind) {
      case "running":
        stepsRun += 1;
        break;
      case "idle":
        return { status: stepsRun === 0 && !options.force ? "fresh" : "synced", stepsRun };
      case "busy":
        return { status: "pending", stepsRun };
      case "auth_required":
        return { status: "auth_required", stepsRun };
      case "error":
        return { status: "error", stepsRun, message: result.message };
    }
  }
}
