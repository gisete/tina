// Checks for offset-aware time ticks (hypnogram + Night Heart chart share buildTimeTicks).
//   TZ=Europe/Lisbon env $(grep -v '^#' .env.local | grep -v '^[[:space:]]*$' | xargs) npx tsx scripts/night-ticks-check.ts
import assert from "node:assert/strict";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { localClockMinutes, offsetForInstant } from "@/lib/dates";
import { formatClockTime } from "@/lib/format";
import { buildTimeTicks } from "@/lib/charts/time-ticks";

// Original (pre-offset) tick routine, verbatim — the null-offset reference.
function origTicks(startTs: number, endTs: number): Array<{ timestamp: number; xPct: number; anchor: string }> {
  const spanMs = Math.max(endTs - startTs, 1);
  const pct = (ts: number) => ((ts - startTs) / spanMs) * 100;
  const ticks = [{ timestamp: startTs, xPct: 0, anchor: "start" }];
  const stepHours = Math.max(1, Math.ceil(spanMs / 3_600_000 / 4));
  const cursor = new Date(startTs);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1);
  for (let t = cursor.getTime(); t < endTs; t += stepHours * 3_600_000) {
    const p = pct(t);
    if (p > 8 && p < 92) ticks.push({ timestamp: t, xPct: p, anchor: "middle" });
  }
  ticks.push({ timestamp: endTs, xPct: 100, anchor: "end" });
  return ticks;
}
// Previous (Phase 3) hypnogram tick routine: start offset aligns, labels by nearer-end rule.
function prevTicks(startTs: number, endTs: number, so: number | null): Array<{ timestamp: number; xPct: number; anchor: string }> {
  const spanMs = Math.max(endTs - startTs, 1);
  const pct = (ts: number) => ((ts - startTs) / spanMs) * 100;
  const ticks = [{ timestamp: startTs, xPct: 0, anchor: "start" }];
  const stepHours = Math.max(1, Math.ceil(spanMs / 3_600_000 / 4));
  let first: number;
  if (so === null) { const c = new Date(startTs); c.setMinutes(0, 0, 0); c.setHours(c.getHours() + 1); first = c.getTime(); }
  else { const o = so * 1000; first = Math.floor((startTs + o) / 3_600_000) * 3_600_000 + 3_600_000 - o; }
  for (let t = first; t < endTs; t += stepHours * 3_600_000) { const p = pct(t); if (p > 8 && p < 92) ticks.push({ timestamp: t, xPct: p, anchor: "middle" }); }
  ticks.push({ timestamp: endTs, xPct: 100, anchor: "end" });
  return ticks;
}
const oldClock = (t: number): string => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const labels = (ts: ReturnType<typeof buildTimeTicks>): string[] => ts.map((t) => formatClockTime(t.timestamp, t.offsetSeconds));
const H = 3_600_000;

// --- fixtures ---------------------------------------------------------------
const s = Date.UTC(2026, 8, 29, 16, 13), e = Date.UTC(2026, 8, 30, 0, 30);
const a = labels(buildTimeTicks(s, e, 3600, 3600)), b = labels(buildTimeTicks(s, e, 32400, 32400));
assert.notDeepEqual(a, b);
console.log("+3600  :", a.join(" | "));
console.log("+32400 :", b.join(" | "));
for (const t of buildTimeTicks(s, e, 19800, 19800).filter((x) => x.anchor === "middle")) {
  assert.equal(localClockMinutes(t.timestamp, 19800) % 60, 0, "ticks on :00 of +5:30 clock");
  assert.notEqual(t.timestamp % H, 0, "not UTC-aligned");
}
// positions are instant-based: offsets change labels/which instants, never the xPct formula
for (const t of buildTimeTicks(s, e, 32400, 32400)) assert.equal(t.xPct, ((t.timestamp - s) / (e - s)) * 100);
// mixed 3600 -> 0 (DST fall-back) night, synthetic and checked in real data below
function assertSane(ts: ReturnType<typeof buildTimeTicks>, name: string): void {
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i].timestamp > ts[i - 1].timestamp, `${name}: ordered`);
  const l = labels(ts);
  assert.equal(new Set(l).size, l.length, `${name}: no repeated label ${l.join(",")}`);
}
const ms = Date.UTC(2026, 9, 24, 20, 56), me = Date.UTC(2026, 9, 25, 5, 30);
assertSane(buildTimeTicks(ms, me, 3600, 0), "synthetic 10-24");
// dense 1h-step fall-back: the repeated 01:00 must be dropped
assertSane(buildTimeTicks(Date.UTC(2026, 9, 25, 0, 20), Date.UTC(2026, 9, 25, 3, 40), 3600, 0), "dense fall-back");
console.log("fixtures ok");

async function main(): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.email, "gisete@gmail.com") });
  if (!user) throw new Error("user not found");
  const rows = (await db.query.sleepSessions.findMany({ where: (t, { eq: q }) => q(t.userId, user.id) }))
    .sort((x, y) => y.sleepDate.localeCompare(x.sleepDate));

  // null offsets == original output (ticks, labels, hover/tooltip strings) on every real session
  let n = 0;
  for (const r of rows) {
    const st = r.startTime.getTime(), en = r.endTime.getTime();
    const got = buildTimeTicks(st, en, null, null);
    const want = origTicks(st, en);
    assert.deepEqual(got.map(({ timestamp, xPct, anchor }) => ({ timestamp, xPct, anchor })), want);
    for (const t of got) assert.equal(formatClockTime(t.timestamp, t.offsetSeconds), oldClock(t.timestamp));
    for (const ts of [st, (st + en) / 2, en]) assert.equal(formatClockTime(ts, offsetForInstant(ts, st, en, null, null)), oldClock(ts));
    n++;
  }
  console.log(`null offsets == original ticks/labels/tooltips on ${n} real sessions: ok`);

  // hypnogram unchanged after extraction: positions identical, labels identical to the Phase 3 output
  let h = 0, changed = 0;
  for (const r of rows) {
    const st = r.startTime.getTime(), en = r.endTime.getTime();
    const so = r.startUtcOffsetSeconds, eo = r.endUtcOffsetSeconds;
    const got = buildTimeTicks(st, en, so, eo), want = prevTicks(st, en, so);
    const same = got.length === want.length && got.every((t, i) => t.timestamp === want[i].timestamp && t.xPct === want[i].xPct);
    if (!same) { changed++; console.log("  tick set differs:", r.sleepDate, so, eo); continue; }
    got.forEach((t, i) => assert.equal(formatClockTime(t.timestamp, t.offsetSeconds), formatClockTime(want[i].timestamp, offsetForInstant(want[i].timestamp, st, en, so, eo))));
    h++;
  }
  console.log(`hypnogram ticks/labels identical to previous output on ${h} sessions; ${changed} differ`);

  const show = (d: string): void => {
    const r = rows.find((x) => x.sleepDate === d && x.totalSleepMs > 3 * H);
    if (!r) return;
    const t = buildTimeTicks(r.startTime.getTime(), r.endTime.getTime(), r.startUtcOffsetSeconds, r.endUtcOffsetSeconds);
    console.log(`\n${d} offsets ${r.startUtcOffsetSeconds}/${r.endUtcOffsetSeconds}  subtitle ${formatClockTime(r.startTime, r.startUtcOffsetSeconds)} – ${formatClockTime(r.endTime, r.endUtcOffsetSeconds)}`);
    console.log("  axis:", labels(t).join(" | "), " (server-local would be:", t.map((x) => oldClock(x.timestamp)).join(" | "), ")");
    assertSane(t, d);
  };
  for (const d of ["2026-09-29", "2026-10-22", "2026-10-24"]) show(d);
  process.exit(0);
}
main();
