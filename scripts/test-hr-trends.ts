import { config } from "dotenv";
config({ path: ".env.local" });

import { calculateHrTrends, trendSentiment, type DailyHrSummary } from "@/lib/analytics/hr-trends";
import { addDays } from "@/lib/dates";
import { readHrSummaries } from "@/lib/sync/read";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// ── Fixture ───────────────────────────────────────────────────────────────────
// today = 2026-06-13
// week  window: 2026-06-07 → 2026-06-13 (7 days)
// month window: 2026-05-15 → 2026-06-13 (30 days)
// 90d   window: 2026-03-16 → 2026-06-13 (90 days)
//
// Previous week: 2026-05-31 → 2026-06-06 (immediately before current week)
// prev avg RHR = (55+57+63+64+65+62)/6 = 61.0
// curr avg RHR = (60+62+58+61+59)/5    = 60.0  → delta = -1.0

const today = "2026-06-13";

const fixture: DailyHrSummary[] = [
  // Previous week entries (2026-05-31 – 2026-06-06)
  { date: "2026-05-31", restingHeartRate: 55, hrv: null },
  { date: "2026-06-01", restingHeartRate: 57, hrv: 50 },
  // 2026-06-02: gap — no entry
  { date: "2026-06-03", restingHeartRate: 63, hrv: 38 },
  { date: "2026-06-04", restingHeartRate: 64, hrv: 37 },
  { date: "2026-06-05", restingHeartRate: 65, hrv: 36 },
  { date: "2026-06-06", restingHeartRate: 62, hrv: 39 },
  // Current week (2026-06-07 – 2026-06-13)
  { date: "2026-06-07", restingHeartRate: 60, hrv: 42 },
  // 2026-06-08: gap — no entry
  { date: "2026-06-09", restingHeartRate: 62, hrv: 40 },
  { date: "2026-06-10", restingHeartRate: 58, hrv: 45 },
  { date: "2026-06-11", restingHeartRate: null, hrv: null }, // explicit null row
  { date: "2026-06-12", restingHeartRate: 61, hrv: 43 },
  { date: "2026-06-13", restingHeartRate: 59, hrv: 44 },
  // Wider month / 90d entries
  { date: "2026-05-15", restingHeartRate: 63, hrv: 35 },
  { date: "2026-05-20", restingHeartRate: 61, hrv: 38 },
  { date: "2026-03-16", restingHeartRate: 66, hrv: 30 },
  { date: "2026-04-01", restingHeartRate: 64, hrv: 32 },
];

// ── Assertion helper ──────────────────────────────────────────────────────────

let failures = 0;

function assert(label: string, got: unknown, expected: unknown) {
  if (JSON.stringify(got) === JSON.stringify(expected)) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      got:      ${JSON.stringify(got)}`);
    failures++;
  }
}

// ── Run engines ───────────────────────────────────────────────────────────────

const week  = calculateHrTrends(fixture, "week",  today);
const month = calculateHrTrends(fixture, "month", today);
const d90   = calculateHrTrends(fixture, "90d",   today);

// ── (a) Week window: last 7 dates, avg ignores nulls ─────────────────────────

console.log("\n(a) week window");
assert("points.length = 7",                     week.points.length,                          7);
assert("first date = 2026-06-07",               week.points[0].date,                         "2026-06-07");
assert("last date = 2026-06-13",                week.points[week.points.length - 1].date,    "2026-06-13");
// avg of 60, 62, 58, 61, 59 = 300/5 = 60.0
assert("windowAvgRhr = 60 (ignores nulls)",     week.stats.windowAvgRhr,                     60);
assert("nightsWithData = 5",                    week.stats.nightsWithData,                   5);
// 2026-06-08 is a gap (no fixture row) → point exists with null
const jun8  = week.points.find((p) => p.date === "2026-06-08");
assert("2026-06-08 gap → restingHeartRate null", jun8?.restingHeartRate,                    null);
// 2026-06-11 is an explicit null row
const jun11 = week.points.find((p) => p.date === "2026-06-11");
assert("2026-06-11 explicit null preserved",    jun11?.restingHeartRate,                     null);

// ── (b) month and 90d slice to correct earliest date ─────────────────────────

console.log("\n(b) month / 90d window boundaries");
assert("month: points.length = 30",             month.points.length,                         30);
assert("month: first date = 2026-05-15",        month.points[0].date,                        "2026-05-15");
assert("month: last date = 2026-06-13",         month.points[month.points.length - 1].date,  "2026-06-13");

assert("90d: points.length = 90",               d90.points.length,                           90);
assert("90d: first date = 2026-03-16",          d90.points[0].date,                          "2026-03-16");
assert("90d: last date = 2026-06-13",           d90.points[d90.points.length - 1].date,      "2026-06-13");

// ── (c) rhrDeltaVsPrev on hand-checkable week fixture ────────────────────────
// prev week = May31–Jun06: RHR values 55, 57, 63, 64, 65, 62 (Jun02 is gap)
// prev avg = 366/6 = 61.0; curr avg = 60.0; delta = -1.0

console.log("\n(c) rhrDeltaVsPrev");
assert("prevWindowAvgRhr = 61",                 week.stats.prevWindowAvgRhr,                 61);
assert("rhrDeltaVsPrev = -1",                   week.stats.rhrDeltaVsPrev,                   -1);

// ── (d) points length = window length, gaps stay null ────────────────────────

console.log("\n(d) gap integrity");
assert("month: all 30 points have a date",      month.points.every((p) => !!p.date),         true);
// 2026-05-16 is not in the fixture — should appear in month with null fields
const may16 = month.points.find((p) => p.date === "2026-05-16");
assert("month: 2026-05-16 gap → null",          may16?.restingHeartRate,                     null);
// 90d window should contain the 2026-03-16 fixture entry
const mar16 = d90.points.find((p) => p.date === "2026-03-16");
assert("90d: 2026-03-16 fixture row present",   mar16?.restingHeartRate,                     66);
// A day not in the fixture inside the 90d window should be null
const mar17 = d90.points.find((p) => p.date === "2026-03-17");
assert("90d: 2026-03-17 gap → null",            mar17?.restingHeartRate,                     null);

// ── (e) HRV stats — integer rounding + direction-aware delta ─────────────────
// curr week HRV non-null: 42, 40, 45, 43, 44  (5 nights; Jun-08 gap, Jun-11 explicit null)
// avg = 214/5 = 42.8 → Math.round = 43
// min = 40, max = 45
// prev week HRV non-null: 50, 38, 37, 36, 39  (May-31 null, Jun-02 gap)
// prev avg = 200/5 = 40 → Math.round = 40
// delta = 43 - 40 = +3  (POSITIVE = IMPROVEMENT for HRV — opposite of RHR)

console.log("\n(e) HRV stats");
assert("windowAvgHrv = 43 (integer round of 42.8)", week.stats.windowAvgHrv,       43);
assert("nightsWithHrv = 5",                         week.stats.nightsWithHrv,      5);
assert("minHrv = 40",                               week.stats.minHrv,             40);
assert("maxHrv = 45",                               week.stats.maxHrv,             45);
assert("prevWindowAvgHrv = 40",                     week.stats.prevWindowAvgHrv,   40);
assert("hrvDeltaVsPrev = +3 (improvement)",         week.stats.hrvDeltaVsPrev,     3);
// 90d: no prior-period HRV data in fixture → null
assert("90d: prevWindowAvgHrv = null",              d90.stats.prevWindowAvgHrv,    null);
assert("90d: hrvDeltaVsPrev = null",                d90.stats.hrvDeltaVsPrev,      null);

// ── (f) trendSentiment — single source of truth for direction logic ───────────

console.log("\n(f) trendSentiment");
assert("HRV +delta  → improvement", trendSentiment("hrv",  3),    "improvement");
assert("HRV -delta  → decline",     trendSentiment("hrv", -3),    "decline");
assert("RHR -delta  → improvement", trendSentiment("rhr", -1),    "improvement");
assert("RHR +delta  → decline",     trendSentiment("rhr",  1),    "decline");
assert("null delta  → neutral",     trendSentiment("rhr",  null), "neutral");
assert("zero delta  → neutral",     trendSentiment("hrv",  0),    "neutral");

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Fixture: ${failures === 0 ? "all assertions passed" : `${failures} failure(s)`} ──\n`);
if (failures > 0) process.exitCode = 1;

// ── Real-DB probe (90d window) ────────────────────────────────────────────────

async function probeRealDb() {
  const userRow = await db.query.users.findFirst({
    where: eq(users.email, "gisete@gmail.com"),
  });
  if (!userRow) {
    console.error("User not found — skipping real-DB probe");
    return;
  }

  const startDate = addDays(today, -89);
  const rows = await readHrSummaries(userRow.id, startDate, today);

  console.log(`Real DB  90d window: ${startDate} → ${today}`);
  console.log(`  row count:     ${rows.length}`);
  if (rows.length > 0) {
    console.log(`  earliest date: ${rows[0].date}`);
    console.log(`  latest date:   ${rows[rows.length - 1].date}`);
  }
}

probeRealDb()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => process.exit(process.exitCode ?? 0));
