// Phase 3 checks: offset-aware clock helpers + real-DB regression.
//   TZ=Europe/Lisbon env $(grep -v '^#' .env.local | grep -v '^[[:space:]]*$' | xargs) npx tsx scripts/offset-clock-check.ts
import assert from "node:assert/strict";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { localClockMinutes, offsetForInstant } from "@/lib/dates";
import { formatClockTime } from "@/lib/format";
import { buildTimeTicks } from "@/lib/charts/time-ticks";
import { calculateCircadianVariance, selectMainSessions } from "@/lib/analytics/sleep";
import { assembleDashboardData, type SleepSessionRow } from "@/lib/sync/assemble";

// The pre-change implementations, verbatim.
const oldClock = (t: number | string | Date): string =>
  new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const oldMinutes = (t: Date): number => t.getHours() * 60 + t.getMinutes();

// --- pure fixtures -------------------------------------------------------
const instant = Date.UTC(2026, 8, 29, 16, 13); // 16:13 UTC
assert.equal(localClockMinutes(instant, 3600), 17 * 60 + 13);
assert.equal(localClockMinutes(instant, 32400), 1 * 60 + 13, "+9h wraps to 01:13");
assert.notEqual(localClockMinutes(instant, 3600), localClockMinutes(instant, 28800));
assert.equal(formatClockTime(instant, 3600), "5:13 PM");
assert.equal(formatClockTime(instant, 32400), "1:13 AM");
assert.equal(localClockMinutes(instant, 0), 16 * 60 + 13);
assert.equal(localClockMinutes(instant, -18000), 11 * 60 + 13);
assert.equal(localClockMinutes(instant, 19800), 21 * 60 + 43, "half-hour zone");
assert.equal(localClockMinutes(instant, null), oldMinutes(new Date(instant)));
assert.equal(localClockMinutes(instant), oldMinutes(new Date(instant)));
assert.equal(formatClockTime(instant, null), oldClock(instant));
assert.equal(formatClockTime(instant), oldClock(instant));
assert.equal(offsetForInstant(5, 0, 100, 3600, 3600), 3600);
assert.equal(offsetForInstant(10, 0, 100, 3600, 0), 3600);
assert.equal(offsetForInstant(90, 0, 100, 3600, 0), 0);
assert.equal(offsetForInstant(10, 0, 100, null, null), null);
// ticks: null path unchanged; offset path lands on whole hours of that clock
const s = Date.UTC(2026, 8, 29, 16, 13), e = Date.UTC(2026, 8, 30, 0, 30);
assert.deepEqual(buildTimeTicks(s, e, null), buildTimeTicks(s, e));
for (const t of buildTimeTicks(s, e, 19800).filter((x) => x.anchor === "middle")) {
  assert.equal(localClockMinutes(t.timestamp, 19800) % 60, 0, "whole hour on +5:30 clock");
}
console.log("fixtures ok");

// --- real DB -------------------------------------------------------------
async function main(): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.email, "gisete@gmail.com") });
  if (!user) throw new Error("user not found");
  const all = await db.query.sleepSessions.findMany({ where: (t, { eq: e }) => e(t.userId, user.id), with: { stages: true } });
  const rows: SleepSessionRow[] = all.sort((a, b) => b.sleepDate.localeCompare(a.sleepDate));
  const strip = (r: SleepSessionRow[]): SleepSessionRow[] => r.map((x) => ({ ...x, startUtcOffsetSeconds: null, endUtcOffsetSeconds: null }));
  const isTrip = (r: SleepSessionRow): boolean => (r.startUtcOffsetSeconds ?? 3600) === 32400;

  // 1. null == old behaviour on >= 10 real non-trip sessions
  const nonTrip = rows.filter((r) => !isTrip(r)).slice(0, 12);
  for (const r of nonTrip) {
    for (const t of [r.startTime, r.endTime]) {
      assert.equal(formatClockTime(t, null), oldClock(t));
      assert.equal(localClockMinutes(t, null), oldMinutes(t));
    }
  }
  console.log(`null == old on ${nonTrip.length} real non-trip sessions: ok`);
  const withOff = nonTrip.filter((r) => r.startUtcOffsetSeconds === 3600);
  for (const r of withOff) assert.equal(formatClockTime(r.startTime, r.startUtcOffsetSeconds), oldClock(r.startTime));
  console.log(`stored +3600 == Lisbon-local old display on ${withOff.length} sessions that have an offset: ok`);

  // 2. trip nights: old vs new bedtime
  console.log("\ntrip nights (sleepDate | old Lisbon start | new offset-local start)");
  for (const r of rows.filter(isTrip).reverse()) {
    console.log(`${r.sleepDate} | ${oldClock(r.startTime).padStart(8)} | ${formatClockTime(r.startTime, r.startUtcOffsetSeconds).padStart(8)}`);
  }

  // 3. circadian stdev before/after at several as-of dates
  console.log("\ncircadian (as-of sleepDate | nights | old avg/sd/status | new avg/sd/status)");
  for (const asOf of ["2026-10-04", "2026-10-05", "2026-10-10", "2026-10-17", "2026-10-22", "latest"]) {
    const sub = rows.filter((r) => asOf === "latest" || r.sleepDate <= asOf);
    const main = selectMainSessions(sub);
    const o = calculateCircadianVariance(selectMainSessions(strip(sub)));
    const n = calculateCircadianVariance(main);
    console.log(`${asOf} | ${n.nights} | ${o.averageBedtimeMinutesFromMidnight}/${o.standardDeviationMinutes}/${o.status} | ${n.averageBedtimeMinutesFromMidnight}/${n.standardDeviationMinutes}/${n.status}`);
  }

  // 4. everything else must be identical: full assemble output, stripped vs real
  let compared = 0;
  const diffs: string[] = [];
  for (const asOf of ["2026-09-29", "2026-10-04", "2026-10-05", "2026-10-10", "2026-10-22", "latest"]) {
    const sub = rows.filter((r) => asOf === "latest" || r.sleepDate < asOf); // strictly-before, like readDashboardData
    if (sub.length === 0) continue;
    const a = assembleDashboardData(strip(sub), [], [], 8, undefined, undefined);
    const b = assembleDashboardData(sub, [], [], 8, undefined, undefined);
    const flat = (o: unknown, path = "", out: Record<string, unknown> = {}): Record<string, unknown> => {
      if (o !== null && typeof o === "object") for (const [k, v] of Object.entries(o)) flat(v, `${path}.${k}`, out);
      else out[path] = o;
      return out;
    };
    const fa = flat(a), fb = flat(b);
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      if (fa[k] !== fb[k]) diffs.push(`${asOf}: ${k}: ${String(fa[k])} -> ${String(fb[k])}`);
    }
    compared++;
  }
  console.log(`\nassemble() compared at ${compared} as-of dates; differing leaves:`);
  const allowed = /\.variance\.|\.(lastNight|latestSummary)\.(start|end)UtcOffsetSeconds/;
  for (const d of diffs) console.log((allowed.test(d.split(": ")[1] + ".") ? "  expected  " : "  UNEXPECTED") + " " + d);
  process.exit(0);
}
main();
