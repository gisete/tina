// Manual recovery range (/api/sync?days=N): today − N .. today, split into the
// same chunks catch-up uses, each one through syncDateRange. The lock is taken
// per chunk, so a long run never outlives the lock TTL and a catch-up step can
// interleave between chunks. Orchestration only; chunking is pure (catch-up.ts).
//
// Exercise-only mode (RecoveryMode) runs just the exercise slice per chunk: no
// sleep, heart summaries, zones or steps are fetched or written.
//
// Recovery is a repair of old data, not a sync of "now": it never moves
// synced_through, never stamps last_synced_at (an old-range repair must not
// make the 6h staleness guard think today is fresh), and never fetches
// intra-night HR samples.

import { localToday } from "@/lib/dates";
import { GoogleAuthError } from "@/lib/google/errors";
import { planRecoveryRange, type RecoveryMode } from "@/lib/sync/catch-up";
import { syncExerciseRange, type ExerciseRowCounts } from "@/lib/sync/exercise-range";
import { syncDateRange, type RangeRowCounts } from "@/lib/sync/range";
import { acquireSyncLock, releaseSyncLock } from "@/lib/sync/sync-state";

export interface RangeChunkResult {
  from: string;
  to: string;
  days: number;
  status: "ok" | "failed" | "busy" | "skipped";
  /** Rows written per table. Present on "ok" (exercise-only runs report just the exercise slice). */
  rows?: RangeRowCounts | ExerciseRowCounts;
  /** Present on "failed". */
  error?: string;
}

export interface RangeSyncResult {
  /** True only when every chunk synced. */
  ok: boolean;
  /** Set when a chunk hit a Google auth failure; the run stops there. */
  authRequired: boolean;
  from: string;
  to: string;
  chunks: RangeChunkResult[];
}

/** Syncs one chunk under the lock. A normal return means the whole chunk was persisted. */
async function syncChunk(
  userId: string,
  from: string,
  to: string,
  mode: RecoveryMode,
): Promise<{ status: "busy" } | { status: "ok"; rows: RangeRowCounts | ExerciseRowCounts }> {
  if (!(await acquireSyncLock(userId))) return { status: "busy" };
  try {
    const rows = mode.kind === "exercise-only"
      ? await syncExerciseRange(userId, from, to)
      : await syncDateRange(userId, from, to);
    return { status: "ok", rows };
  } finally {
    await releaseSyncLock(userId).catch((e: unknown) =>
      console.warn("[range-sync] lock release failed:", e instanceof Error ? e.message : e),
    );
  }
}

export async function runRangeSync(userId: string, days: number, mode: RecoveryMode): Promise<RangeSyncResult> {
  const today = localToday();
  const plan = planRecoveryRange(today, days);
  const chunks: RangeChunkResult[] = [];
  let authRequired = false;
  let stopped = false;

  for (const chunk of plan) {
    const base = { from: chunk.from, to: chunk.to, days: chunk.days };
    if (stopped) {
      chunks.push({ ...base, status: "skipped" });
      continue;
    }
    try {
      const result = await syncChunk(userId, chunk.from, chunk.to, mode);
      if (result.status === "busy") {
        chunks.push({ ...base, status: "busy" });
        stopped = true; // another sync holds the lock; don't queue behind it
      } else {
        chunks.push({ ...base, status: "ok", rows: result.rows });
      }
    } catch (err) {
      console.warn("[range-sync]", err instanceof Error ? err.message : err);
      chunks.push({ ...base, status: "failed", error: err instanceof Error ? err.message : "Sync failed" });
      if (err instanceof GoogleAuthError) authRequired = true;
      stopped = true; // stop at the first failing chunk; earlier chunks stay saved
    }
  }

  return {
    ok: chunks.every((c) => c.status === "ok"),
    authRequired,
    from: plan[0]?.from ?? today,
    to: today,
    chunks,
  };
}
