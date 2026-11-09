// Cooldown for forced syncs — pure. Decides from the last successful recent-window sync alone.

/** Minimum gap between forced syncs. */
export const FORCE_COOLDOWN_SECONDS = 300;

export type ForceCooldownDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * `lastSyncedAtMs` is sync_state.last_synced_at as epoch ms (null = never synced).
 * Allowed once the cooldown has fully elapsed; otherwise the whole seconds still to wait
 * (rounded up, at least 1, at most the cooldown even if the stored clock is ahead of ours).
 */
export function decideForceCooldown(
  nowMs: number,
  lastSyncedAtMs: number | null,
  cooldownSeconds: number = FORCE_COOLDOWN_SECONDS,
): ForceCooldownDecision {
  if (lastSyncedAtMs === null) return { allowed: true };
  const remainingMs = lastSyncedAtMs + cooldownSeconds * 1000 - nowMs;
  if (remainingMs <= 0) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.min(cooldownSeconds, Math.max(1, Math.ceil(remainingMs / 1000))) };
}
