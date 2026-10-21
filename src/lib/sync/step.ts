// One unit of catch-up work per call: lock → pick unit → sync range → advance
// cursor → release lock. Orchestration only; planning is pure (catch-up.ts).

import { localToday } from "@/lib/dates";
import { GoogleAuthError } from "@/lib/google/errors";
import { isSyncStale, TODAY_STALE_AFTER_HOURS } from "@/lib/today";
import { advanceCursor, gapProgress, pickNextUnit, planCatchUp } from "@/lib/sync/catch-up";
import { syncDateRange } from "@/lib/sync/range";
import {
  acquireSyncLock,
  readSyncState,
  releaseSyncLock,
  stampSyncedNow,
  writeSyncedThrough,
} from "@/lib/sync/sync-state";
import type { SyncStepRequest, SyncStepResult } from "@/lib/sync/step-types";

/** Maps a thrown value to the wire result. Auth failures are never generic errors. */
export function toStepError(err: unknown): SyncStepResult {
  if (err instanceof GoogleAuthError) return { kind: "auth_required" };
  return { kind: "error", message: err instanceof Error ? err.message : "Sync failed" };
}

export async function runSyncStep(userId: string, opts: SyncStepRequest = {}): Promise<SyncStepResult> {
  if (!(await acquireSyncLock(userId))) return { kind: "busy" };

  try {
    const state = await readSyncState(userId);
    const today = localToday();
    const plan = planCatchUp(state.syncedThrough, today);
    const unit = pickNextUnit(plan, {
      syncedThrough: state.syncedThrough,
      today,
      stale: isSyncStale(state.lastSyncedAtMs, Date.now(), TODAY_STALE_AFTER_HOURS),
      force: opts.force === true,
    });
    if (!unit) return { kind: "idle" };

    await syncDateRange(userId, unit.range.from, unit.range.to);

    // Only the recent window moves the sync clock; chunks must not postpone staleness.
    if (unit.kind === "recent") await stampSyncedNow(userId);

    // Cursor moves only after the whole unit succeeded, and only contiguously.
    const next = advanceCursor(state.syncedThrough, unit.range.from, unit.range.to);
    if (next !== null && next !== state.syncedThrough) await writeSyncedThrough(userId, next);

    const { daysDone, daysTotal } = gapProgress(
      opts.previousTotal ?? 0,
      plan.gapDays,
      planCatchUp(next, today).gapDays,
    );
    return {
      kind: "running",
      unit: unit.kind,
      from: unit.range.from,
      to: unit.range.to,
      daysDone,
      daysTotal,
    };
  } catch (err) {
    console.warn("[sync-step]", err instanceof Error ? err.message : err);
    return toStepError(err);
  } finally {
    // A failed release must not replace the result; the 2-minute TTL frees the lock anyway.
    await releaseSyncLock(userId).catch((e: unknown) =>
      console.warn("[sync-step] lock release failed:", e instanceof Error ? e.message : e),
    );
  }
}
