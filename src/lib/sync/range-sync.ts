// Manual wide-range sync (/api/sync?days=N): today − N .. today, split into the
// same chunks catch-up uses, each one through syncDateRange. The lock is taken
// per chunk, so a long run never outlives the lock TTL and a catch-up step can
// interleave between chunks. Orchestration only; chunking is pure (catch-up.ts).

import { localToday, addDays } from "@/lib/dates";
import { GoogleAuthError } from "@/lib/google/errors";
import { advanceCursor, splitRange } from "@/lib/sync/catch-up";
import { ensureLatestNightSamples } from "@/lib/sync/night-samples";
import { syncDateRange } from "@/lib/sync/range";
import {
  acquireSyncLock,
  readSyncState,
  releaseSyncLock,
  stampSyncedNow,
  writeSyncedThrough,
} from "@/lib/sync/sync-state";

export interface RangeChunkResult {
  from: string;
  to: string;
  days: number;
  status: "ok" | "failed" | "busy" | "skipped";
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
  /** sync_state.synced_through after the run. */
  syncedThrough: string | null;
}

/** Syncs one chunk under the lock. A normal return means the whole chunk was persisted. */
async function syncChunk(userId: string, from: string, to: string): Promise<"ok" | "busy"> {
  if (!(await acquireSyncLock(userId))) return "busy";
  try {
    await syncDateRange(userId, from, to);
    // Cursor moves only after the whole chunk succeeded, and only contiguously.
    const state = await readSyncState(userId);
    const next = advanceCursor(state.syncedThrough, from, to);
    if (next !== null && next !== state.syncedThrough) await writeSyncedThrough(userId, next);
    return "ok";
  } finally {
    await releaseSyncLock(userId).catch((e: unknown) =>
      console.warn("[range-sync] lock release failed:", e instanceof Error ? e.message : e),
    );
  }
}

export async function runRangeSync(userId: string, days: number): Promise<RangeSyncResult> {
  const today = localToday();
  const from = addDays(today, -days);
  const plan = splitRange(from, today);
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
      const status = await syncChunk(userId, chunk.from, chunk.to);
      chunks.push({ ...base, status });
      if (status === "busy") stopped = true; // another sync holds the lock; don't queue behind it
    } catch (err) {
      console.warn("[range-sync]", err instanceof Error ? err.message : err);
      chunks.push({ ...base, status: "failed", error: err instanceof Error ? err.message : "Sync failed" });
      if (err instanceof GoogleAuthError) {
        authRequired = true;
        stopped = true; // every remaining chunk would fail the same way
      }
    }
  }

  const ok = chunks.every((c) => c.status === "ok");
  let syncedThrough: string | null = null;
  try {
    if (ok) {
      await stampSyncedNow(userId);
      // Best-effort, like the recent window: the sleep page's lazy fetch is the fallback.
      await ensureLatestNightSamples(userId).catch((e: unknown) =>
        console.warn("[range-sync] night HR samples failed (continuing):", e instanceof Error ? e.message : e),
      );
    }
    syncedThrough = (await readSyncState(userId)).syncedThrough;
  } catch (err) {
    // The chunks are already persisted; don't hide their results behind a bookkeeping failure.
    console.warn("[range-sync] post-sync bookkeeping failed:", err instanceof Error ? err.message : err);
  }

  return { ok, authRequired, from, to: today, chunks, syncedThrough };
}
