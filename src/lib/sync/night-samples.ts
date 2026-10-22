// Intra-night heart-rate sample cache. Lives outside the "use server" actions
// file on purpose: exporting these from there would expose them as callable
// server actions that accept an arbitrary userId.

import { db } from "@/db/client";
import { heartRateSamples, sleepSessions } from "@/db/schema";
import { fetchGoogleHeartRateSamples } from "@/lib/google/client";
import { normalizeHeartRateSamples } from "@/lib/google/normalizers";
import { selectMainSessions } from "@/lib/analytics/sleep";
import { persistHeartRateSamples } from "@/lib/sync/persist";
import { eq, and, asc, desc, gte, lte } from "drizzle-orm";

/**
 * Minimum cached samples before a night is considered fully populated.
 * Below this, we attempt a Google fetch on first read.
 */
const MIN_NIGHT_SAMPLES = 10;

/**
 * Ensures the heart_rate_samples cache is populated for the given session.
 * Returns cached samples immediately when the cache is warm (≥ MIN_NIGHT_SAMPLES).
 * On a cold cache, fetches from Google once, persists permanently, and returns
 * the fresh samples.
 *
 * This is a deliberate, narrow exception to the read/sync split: it fires at
 * most once per night ever (permanently cached after first view), only for the
 * single session being displayed, and only when samples are genuinely absent.
 * Don't remove this Google call in the name of "reads don't hit Google" —
 * that rule is about avoiding full syncs on every navigation, not about
 * blocking lazy one-off population of permanent cache entries.
 *
 * Sample queries key on session start_time/end_time (timestamps), not
 * sleep_date, so results are unaffected by any historical sleep_date mis-keying
 * from before the nightOf() fix.
 */
export async function ensureNightSamples(
  userId: string,
  session: { startTime: Date; endTime: Date },
): Promise<Array<{ timestamp: Date; bpm: number }>> {
  const sampleQuery = () =>
    db.query.heartRateSamples.findMany({
      where: and(
        eq(heartRateSamples.userId, userId),
        gte(heartRateSamples.timestamp, session.startTime),
        lte(heartRateSamples.timestamp, session.endTime),
      ),
      orderBy: [asc(heartRateSamples.timestamp)],
    });

  const cached = await sampleQuery();
  if (cached.length >= MIN_NIGHT_SAMPLES) return cached;

  try {
    const raw = await fetchGoogleHeartRateSamples(
      userId,
      session.startTime.toISOString(),
      session.endTime.toISOString(),
    );
    const normalized = normalizeHeartRateSamples(userId, raw);
    if (normalized.length > 0) {
      await persistHeartRateSamples(normalized);
      console.log(`[sync] Fetched ${normalized.length} heart-rate samples for ${session.startTime.toISOString()}`);
      return sampleQuery();
    }
  } catch (err) {
    console.warn(
      "[sync] HR samples fetch failed (continuing):",
      err instanceof Error ? err.message : err,
    );
  }

  return cached;
}

/**
 * Populates the HR sample cache for the most-recent main session if sparse.
 * Selection mirrors the block runGoogleSync always used: the 5 newest sessions
 * by sleep_date, then the first main session among them.
 */
export async function ensureLatestNightSamples(userId: string): Promise<void> {
  const recentSessions = await db.query.sleepSessions.findMany({
    where: eq(sleepSessions.userId, userId),
    orderBy: [desc(sleepSessions.sleepDate)],
    limit: 5,
  });
  const mainSession = selectMainSessions(recentSessions)[0];
  if (mainSession) {
    await ensureNightSamples(userId, mainSession);
  }
}
