import type { MotivationLine } from "./types";

/** FNV-1a 32-bit — stable across runtimes, unlike anything seeded. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Deterministic pick of one active line for a local "YYYY-MM-DD" date:
 * hash(date) mod count over active lines ordered by id. Empty → null.
 */
export function pickMotivationLine(date: string, lines: MotivationLine[]): MotivationLine | null {
  const active = lines.filter((l) => l.active).sort((a, b) => a.id - b.id);
  if (active.length === 0) return null;
  return active[hashString(date) % active.length];
}
