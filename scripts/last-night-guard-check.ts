// Guard checks: getLastNightDetail ignores sessions with no positive time in bed,
// and the Sleep Score Trend skips them. Run: npx tsx scripts/last-night-guard-check.ts
import assert from "node:assert/strict";
import { getLastNightDetail } from "@/lib/analytics/sleep";
import { assembleDashboardData } from "@/lib/sync/assemble";

const stage = (stageType: "deep" | "light" | "rem" | "awake", start: string, end: string) => ({
  stageType,
  startTime: start,
  endTime: end,
  durationMs: new Date(end).getTime() - new Date(start).getTime(),
});
const base = {
  sleepDate: "2026-10-21",
  totalSleepMs: 7 * 3_600_000,
  efficiencyScore: 0.9,
  stages: [stage("light", "2026-10-21T23:00:00Z", "2026-10-22T03:00:00Z"), stage("deep", "2026-10-22T03:00:00Z", "2026-10-22T07:00:00Z")],
};
const at = (iso: string) => new Date(iso);
const normal = { ...base, startTime: at("2026-10-21T23:00:00Z"), endTime: at("2026-10-22T07:00:00Z") };
const reversed = { ...base, startTime: at("2026-10-22T07:00:00Z"), endTime: at("2026-10-21T23:00:00Z") };
const zero = { ...base, startTime: at("2026-10-22T07:00:00Z"), endTime: at("2026-10-22T07:00:00Z") };

const ok = getLastNightDetail([normal]);
assert.ok(ok && ok.holisticScore > 0 && ok.timeline.length === 2);
assert.equal(getLastNightDetail([reversed]), null);
assert.equal(getLastNightDetail([zero]), null);
assert.equal(getLastNightDetail([]), null);

const row = (d: string, s: string, e: string) => ({
  id: d, userId: "u", sleepDate: d, startTime: new Date(s), endTime: new Date(e), totalSleepMs: 6 * 3_600_000,
  efficiencyScore: 0.9, continuityScore: null, timelineRaw: null, source: "x", createdAt: new Date(),
  stages: [{ id: d, sessionId: d, stageType: "light" as const, startTime: new Date(s), endTime: new Date(e), durationMs: 6 * 3_600_000 }],
});
const rows = [
  row("2026-10-21", "2026-10-21T23:00:00Z", "2026-10-22T07:00:00Z"),
  row("2026-10-20", "2026-10-20T23:00:00Z", "2026-10-21T07:00:00Z"),
  row("2026-10-19", "2026-10-20T07:00:00Z", "2026-10-19T23:00:00Z"), // malformed
];
const data = assembleDashboardData(rows, [], []);
assert.ok(data.hasData);
if (data.hasData) {
  assert.deepEqual(data.chartTimeline.map((p) => p.date), ["2026-10-20", "2026-10-21"]);
  assert.ok(data.lastNight && data.lastNight.sleepDate === "2026-10-21");
}
console.log("ALL CHECKS PASSED");
