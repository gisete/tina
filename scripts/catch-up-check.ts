// Fixture checks for src/lib/sync/catch-up.ts. Run under several timezones:
//   TZ=Europe/Lisbon npx tsx scripts/catch-up-check.ts
import assert from "node:assert/strict";
import { addDays, diffDays } from "@/lib/dates";
import {
  CHUNK_DAYS,
  RECENT_WINDOW_DAYS,
  advanceCursor,
  deriveSyncedThrough,
  planCatchUp,
} from "@/lib/sync/catch-up";

const TODAY = "2026-10-21";
const fmt = (c: { from: string; to: string; days: number }) => `${c.from}..${c.to}(${c.days})`;

/** Every gap day is covered by exactly one chunk, none by two, none missing. */
function assertTiles(syncedThrough: string, today: string): void {
  const plan = planCatchUp(syncedThrough, today);
  const gapStart = addDays(syncedThrough, 1);
  const gapEnd = addDays(plan.recent.from, -1);
  const seen = new Map<string, number>();
  for (const c of plan.gapChunks) {
    assert.ok(c.days >= 1 && c.days <= CHUNK_DAYS, `chunk size ${fmt(c)}`);
    assert.equal(c.days, diffDays(c.from, c.to) + 1);
    for (let d = c.from; d <= c.to; d = addDays(d, 1)) seen.set(d, (seen.get(d) ?? 0) + 1);
  }
  let expected = 0;
  for (let d = gapStart; d <= gapEnd; d = addDays(d, 1)) {
    expected++;
    assert.equal(seen.get(d), 1, `${d} covered once`);
  }
  assert.equal(seen.size, expected, "no chunk day outside the gap");
  assert.equal(plan.gapDays, expected);
  for (let i = 1; i < plan.gapChunks.length; i++) {
    assert.equal(plan.gapChunks[i].from, addDays(plan.gapChunks[i - 1].to, 1), "contiguous");
  }
}

// 1. Gap 0 days.
{
  const p = planCatchUp(TODAY, TODAY);
  assert.deepEqual(p.recent, { from: "2026-10-18", to: "2026-10-21", days: 4 });
  assert.equal(p.gapChunks.length, 0);
  console.log("1 gap 0:", fmt(p.recent), "chunks", p.gapChunks.length);
}

// 2. Gap 2 days: inside the recent window, so no gap chunks.
{
  const p = planCatchUp("2026-10-19", TODAY);
  assert.equal(p.gapChunks.length, 0);
  // Gap of exactly RECENT_WINDOW_DAYS + 1 days behind today is still recent-only.
  const edge = planCatchUp(addDays(TODAY, -(RECENT_WINDOW_DAYS + 1)), TODAY);
  assert.equal(edge.gapChunks.length, 0);
  // One day further back needs exactly one 1-day chunk.
  const over = planCatchUp(addDays(TODAY, -(RECENT_WINDOW_DAYS + 2)), TODAY);
  assert.deepEqual(over.gapChunks.map(fmt), ["2026-10-17..2026-10-17(1)"]);
  console.log("2 gap 2:", p.gapChunks.length, "chunks; edge", edge.gapChunks.length, "; over", over.gapChunks.map(fmt));
}

// 3. Gap 95 days, exact boundaries.
{
  const p = planCatchUp("2026-07-14", TODAY);
  const got = p.gapChunks.map(fmt);
  assert.deepEqual(got, [
    "2026-07-15..2026-07-28(14)",
    "2026-07-29..2026-08-11(14)",
    "2026-08-12..2026-08-25(14)",
    "2026-08-26..2026-09-08(14)",
    "2026-09-09..2026-09-22(14)",
    "2026-09-23..2026-10-06(14)",
    "2026-10-07..2026-10-17(11)",
  ]);
  assert.equal(p.gapDays, 95);
  assertTiles("2026-07-14", TODAY);
  console.log("3 gap 95:", got.length, "chunks\n   ", got.join("\n    "));
}

// 4. Gap crossing the end-of-October DST change (Europe/Lisbon: 2026-10-25),
//    plus the other DST changes that fall near it.
{
  const p = planCatchUp("2026-10-20", "2026-11-12");
  assert.deepEqual(p.gapChunks.map(fmt), ["2026-10-21..2026-11-03(14)", "2026-11-04..2026-11-08(5)"]);
  assertTiles("2026-10-20", "2026-11-12");
  assertTiles("2026-09-20", "2026-11-12"); // spans NZ (09-27), EU (10-25), US (11-01)
  assertTiles("2026-03-20", "2026-04-20"); // spans EU (03-29) and NZ (04-05) changes
  assert.equal(diffDays("2026-10-24", "2026-10-26"), 2);
  console.log("4 DST:", p.gapChunks.map(fmt).join(" | "));
}

// 5. Null cursor keeps the existing default: only the recent window.
{
  const p = planCatchUp(null, TODAY);
  assert.equal(p.gapChunks.length, 0);
  assert.equal(p.gapDays, 0);
  assert.equal(advanceCursor(null, "2026-10-18", "2026-10-21"), null);
  console.log("5 null cursor: recent only, cursor stays null");
}

// 6. advanceCursor.
{
  const a = advanceCursor("2026-07-18", "2026-10-18", "2026-10-21");
  assert.equal(a, "2026-07-18");
  const b = advanceCursor("2026-07-18", "2026-07-19", "2026-08-01");
  assert.equal(b, "2026-08-01");
  // Recent window directly after the gap is filled advances to today.
  const c = advanceCursor("2026-10-17", "2026-10-18", "2026-10-21");
  assert.equal(c, "2026-10-21");
  // One-day hole (cursor 10-16, chunk starts 10-18) must not advance.
  assert.equal(advanceCursor("2026-10-16", "2026-10-18", "2026-10-21"), "2026-10-16");
  // A chunk that overlaps the cursor advances; one fully behind it does not move it back.
  assert.equal(advanceCursor("2026-08-05", "2026-07-30", "2026-08-12"), "2026-08-12");
  assert.equal(advanceCursor("2026-08-05", "2026-07-20", "2026-08-01"), "2026-08-05");
  assert.equal(advanceCursor("2026-08-05", "2026-08-09", "2026-08-02"), "2026-08-05");
  console.log("6 advanceCursor:", { recentWithGap: a, contiguousChunk: b, recentAfterFill: c });
}

// 7. deriveSyncedThrough on data shaped like the live DB (sleep, heart and
//    non-zero-AZM days only; the steps-only 10-14..10-17 rows are NOT covered).
{
  const span = (from: string, to: string): string[] => {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  };
  const covered = [
    ...span("2026-07-01", "2026-07-03"),
    ...span("2026-07-10", "2026-07-18"),
    ...span("2026-10-18", "2026-10-21"),
  ];
  assert.equal(deriveSyncedThrough(covered, TODAY), "2026-07-18");
  // The walk reports the end of the island below the most recent gap, so the
  // steps-only rows (a shorter gap, 07-19..10-13) still yield 07-18, never 10-13.
  assert.equal(deriveSyncedThrough([...covered, ...span("2026-10-14", "2026-10-17")], TODAY), "2026-07-18");
  assert.equal(deriveSyncedThrough(span("2026-10-01", TODAY), TODAY), TODAY);
  assert.equal(deriveSyncedThrough([], TODAY), null);
  assert.equal(deriveSyncedThrough([TODAY], TODAY), TODAY);
  assert.equal(deriveSyncedThrough(["2026-10-21", "2026-10-19"], TODAY), "2026-10-19");
  assert.equal(deriveSyncedThrough(["2026-10-19", "2026-10-20"], TODAY), "2026-10-20");
  console.log("7 deriveSyncedThrough (live-shaped):", deriveSyncedThrough(covered, TODAY));
}

console.log(`ALL CHECKS PASSED (TZ=${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone})`);
