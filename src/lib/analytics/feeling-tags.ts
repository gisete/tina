// Pure feeling-tag definitions — no React/Next/DB imports.
// IDs are permanent: never renumber or reuse a retired id.

export interface FeelingTag {
  id: number;
  slug: string;
  description: string;
  valence: number;
}

// Not type-annotated so the outer `as const` preserves literal id types for FeelingTagId.
// Ordered by valence ascending so the rendered list reads as a scale (drained → energized).
// Note intentional id/valence swap: id 4 = valence 5, id 5 = valence 4.
export const FEELING_TAGS = [
  { id: 1, slug: "drained",      description: "Mentally and physically drained",    valence: 1 },
  { id: 2, slug: "tired-okay",   description: "Tired, but okay",                    valence: 2 },
  { id: 3, slug: "sleepy",       description: "Sleepy",                             valence: 3 },
  { id: 5, slug: "sluggish",     description: "Not tired, but sluggish",            valence: 4 },
  { id: 4, slug: "tired-energy", description: "A little tired, but have energy",    valence: 5 },
  { id: 6, slug: "energized",    description: "Fully energized",                    valence: 6 },
] as const;

/** Literal union of every valid tag id — derived from the array, stays in sync automatically. */
export type FeelingTagId = (typeof FEELING_TAGS)[number]["id"];

/** O(1) set for server-side id validation. */
export const VALID_FEELING_TAG_IDS: ReadonlySet<number> = new Set<number>(
  FEELING_TAGS.map((t) => t.id),
);
