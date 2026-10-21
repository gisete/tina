// sync_state reads/writes for the catch-up step: lock, cursor, sync clock.
// All keyed by user_id. Lock and clock use the database clock (NOW()).

import { db } from "@/db/client";
import { syncState } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/** How long a step may hold the lock before it is considered abandoned. */
const LOCK_TTL_MINUTES = 2;

export interface SyncStateSnapshot {
  lastSyncedAtMs: number | null;
  syncedThrough: string | null;
}

/** Makes sure a row exists. A brand-new user gets epoch as "last synced" (stale). */
async function ensureRow(userId: string): Promise<void> {
  await db.insert(syncState).values({ userId, lastSyncedAt: new Date(0) }).onConflictDoNothing();
}

/**
 * Atomically takes the lock: one UPDATE that only matches when no live lock
 * exists, so two concurrent callers can never both win.
 */
export async function acquireSyncLock(userId: string): Promise<boolean> {
  await ensureRow(userId);
  const rows = await db
    .update(syncState)
    .set({ lockUntil: sql`NOW() + (${LOCK_TTL_MINUTES} * INTERVAL '1 minute')` })
    .where(
      sql`${syncState.userId} = ${userId} AND (${syncState.lockUntil} IS NULL OR ${syncState.lockUntil} < NOW())`,
    )
    .returning({ userId: syncState.userId });
  return rows.length === 1;
}

export async function releaseSyncLock(userId: string): Promise<void> {
  await db.update(syncState).set({ lockUntil: null }).where(eq(syncState.userId, userId));
}

export async function readSyncState(userId: string): Promise<SyncStateSnapshot> {
  const [row] = await db.select().from(syncState).where(eq(syncState.userId, userId));
  const epoch = row?.lastSyncedAt?.getTime() ?? null;
  return {
    // The epoch placeholder from ensureRow means "never synced".
    lastSyncedAtMs: epoch === null || epoch === 0 ? null : epoch,
    syncedThrough: row?.syncedThrough ?? null,
  };
}

export async function writeSyncedThrough(userId: string, date: string): Promise<void> {
  await db.update(syncState).set({ syncedThrough: date }).where(eq(syncState.userId, userId));
}

/** Stamps the sync clock (recent window only). */
export async function stampSyncedNow(userId: string): Promise<void> {
  await db.update(syncState).set({ lastSyncedAt: sql`NOW()` }).where(eq(syncState.userId, userId));
}
