/**
 * For each sleepDate, keeps only the session with the largest totalSleepMs.
 * A short nap on the same calendar date as the main sleep must not count as a
 * full night for debt accumulation, circadian variance, or bedtime analytics.
 * Preserves the original array ordering.
 */
export function selectMainSessions<T extends { sleepDate: string; totalSleepMs: number }>(
  sessions: T[]
): T[] {
  const byDate = new Map<string, T>();
  for (const s of sessions) {
    const current = byDate.get(s.sleepDate);
    if (!current || s.totalSleepMs > current.totalSleepMs) {
      byDate.set(s.sleepDate, s);
    }
  }
  const mainSet = new Set(byDate.values());
  return sessions.filter((s) => mainSet.has(s));
}
