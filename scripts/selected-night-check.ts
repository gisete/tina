// Fixtures for resolveSelectedNight + formatNightRange. Run: npx tsx scripts/selected-night-check.ts
import assert from "node:assert/strict";
import { resolveSelectedNight } from "@/lib/analytics/sleep";
import { formatNightRange } from "@/lib/format";

const s = (sleepDate: string, totalSleepMs: number, id = sleepDate) => ({ id, sleepDate, totalSleepMs });
const TODAY = "2026-10-22";

// 1 exact hit: picking 10-22 shows the 10-21 night.
{
  const r = resolveSelectedNight({ sessions: [s("2026-10-20", 5), s("2026-10-21", 7)], selectedDate: TODAY, today: TODAY });
  assert.equal(r.status, "recorded");
  if (r.status === "recorded") assert.deepEqual([r.nightOf, r.session.id], ["2026-10-21", "2026-10-21"]);
}
// 2 D-1 missing on today, older sessions exist → missing with fallback.
{
  const r = resolveSelectedNight({ sessions: [s("2026-10-19", 5), s("2026-10-20", 7)], selectedDate: TODAY, today: TODAY });
  assert.equal(r.status, "missing");
  if (r.status === "missing") {
    assert.equal(r.expectedNightOf, "2026-10-21");
    assert.equal(r.fallback?.nightOf, "2026-10-20");
    assert.equal(r.fallback?.session.id, "2026-10-20");
  }
}
// 3 same situation on a past date → fallback null.
{
  const r = resolveSelectedNight({ sessions: [s("2026-10-19", 5), s("2026-10-20", 7)], selectedDate: "2026-10-22", today: "2026-10-23" });
  assert.equal(r.status, "missing");
  if (r.status === "missing") assert.equal(r.fallback, null);
}
// 4 no sessions at all.
{
  for (const [sel, expected] of [[TODAY, "2026-10-21"], ["2026-10-01", "2026-09-30"]]) {
    const r = resolveSelectedNight({ sessions: [], selectedDate: sel, today: TODAY });
    assert.deepEqual(r, { status: "missing", expectedNightOf: expected, fallback: null });
  }
}
// 5 two sessions on the same night → the main (longest) one, in either order.
{
  for (const sessions of [[s("2026-10-21", 3, "nap"), s("2026-10-21", 9, "main")], [s("2026-10-21", 9, "main"), s("2026-10-21", 3, "nap")]]) {
    const r = resolveSelectedNight({ sessions, selectedDate: TODAY, today: TODAY });
    assert.equal(r.status, "recorded");
    if (r.status === "recorded") assert.equal(r.session.id, "main");
  }
  // A nap-only newer date doesn't beat the older main for fallback ordering; fallback is the latest main.
  const r = resolveSelectedNight({ sessions: [s("2026-10-19", 9, "main19"), s("2026-10-20", 1, "nap20")], selectedDate: TODAY, today: TODAY });
  assert.equal(r.status, "missing");
  if (r.status === "missing") assert.equal(r.fallback?.session.id, "nap20");
}
// 6 a session starting after midnight is keyed to the previous nightOf: picking 10-21 finds it via sleepDate 10-20.
{
  const afterMidnight = { id: "late", sleepDate: "2026-10-20", totalSleepMs: 6, startTime: "2026-10-21T00:40:00" };
  const r = resolveSelectedNight({ sessions: [afterMidnight], selectedDate: "2026-10-21", today: TODAY });
  assert.equal(r.status, "recorded");
  if (r.status === "recorded") assert.equal(r.session.id, "late");
}
// 7 future date → missing, no fallback.
{
  const r = resolveSelectedNight({ sessions: [s("2026-10-21", 7)], selectedDate: "2026-10-30", today: TODAY });
  assert.equal(r.status, "missing");
  if (r.status === "missing") assert.equal(r.fallback, null);
}
// 8 formatNightRange, incl. month/year rollover.
assert.equal(formatNightRange("2026-10-20"), "Night of Tue, Oct 20 → Wed, Oct 21");
assert.equal(formatNightRange("2026-12-31"), "Night of Thu, Dec 31 → Fri, Jan 1");
assert.equal(formatNightRange("2026-10-24"), "Night of Sat, Oct 24 → Sun, Oct 25"); // EU DST end weekend

console.log(`ALL CHECKS PASSED (TZ=${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone})`);
