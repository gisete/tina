// Task 13: one-off, READ-ONLY probe of Google's exercise-related data types.
// Run: npx tsx docs/exercise-probe/probe-exercise.ts
// Reuses the app's auth helper (may refresh the OAuth access token, writing `account`).
// Saves raw responses next to this file. Never prints or stores the access token.
import "../../scripts/_load-env";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGoogleValidClientToken } from "@/lib/google/client";
import { addDays, localToday } from "@/lib/dates";

const BASE = "https://health.googleapis.com/v4/users/me/dataTypes";
const civil = (s: string) => { const [year, month, day] = s.split("-").map(Number); return { date: { year, month, day } }; };
const save = (name: string, body: unknown) => writeFileSync(join(__dirname, name), JSON.stringify(body, null, 2) + "\n");
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

let token = "";
async function call(method: "GET" | "POST", url: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Json = text;
  try { json = JSON.parse(text) as Json; } catch { /* keep text */ }
  return { status: res.status, json };
}

/** Paged list; returns all pages raw. */
async function list(type: string, filter: string, pageSize?: number): Promise<{ status: number; pages: Json[] }> {
  const pages: Json[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 80; i++) {
    const p = new URLSearchParams({ filter });
    if (pageSize) p.set("pageSize", String(pageSize));
    if (pageToken) p.set("pageToken", pageToken);
    const { status, json } = await call("GET", `${BASE}/${type}/dataPoints?${p}`);
    pages.push(json);
    if (status !== 200) return { status, pages };
    pageToken = (json as { nextPageToken?: string }).nextPageToken;
    if (!pageToken) break;
  }
  return { status: 200, pages };
}

/** First value for `key` anywhere inside `v`. */
function find(v: Json, key: string): Json | undefined {
  if (Array.isArray(v)) { for (const x of v) { const r = find(x, key); if (r !== undefined) return r; } return undefined; }
  if (v !== null && typeof v === "object") {
    if (key in v) return v[key];
    for (const x of Object.values(v)) { const r = find(x, key); if (r !== undefined) return r; }
  }
  return undefined;
}
/** Local civil date of a workout: startTime + startUtcOffset (exercise points carry no civil time). */
const localDay = (p: Json): string | null => {
  const st = find(p, "startTime"); const off = find(p, "startUtcOffset");
  if (typeof st !== "string") return null;
  const sec = typeof off === "string" ? Number(off.replace("s", "")) : 0;
  const d = new Date(Date.parse(st) + sec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

async function main(): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.email, "gisete@gmail.com") });
  if (!user) throw new Error("user not found");
  token = await getGoogleValidClientToken(user.id);

  const today = localToday();
  const from = addDays(today, -30);
  const toExcl = addDays(today, 1);

  // 1. exercise data points, last 30 days. Filter field name follows the other interval types.
  // exercise only supports the CIVIL start-time member (local dates), which also avoids any UTC date shifting.
  const ex = await list("exercise", `exercise.interval.civil_start_time >= "${from}" AND exercise.interval.civil_start_time < "${toExcl}"`);
  save("exercise-list-30d.json", { filter: "exercise.interval.civil_start_time, last 30 days", httpStatus: ex.status, pages: ex.pages });
  console.log(`exercise list: HTTP ${ex.status}, ${ex.pages.length} page(s)`);
  if (ex.status !== 200) { console.log("stopping: exercise list failed — see exercise-list-30d.json"); process.exit(0); }
  const points = ex.pages.flatMap((p) => ((p as { dataPoints?: Json[] }).dataPoints ?? []));
  console.log(`exercise points: ${points.length}`);

  // 2. total-calories dailyRollUp, 14-day max per request -> 30 days = 3 requests.
  const cal: { range: [string, string]; status: number; json: Json }[] = [];
  for (let s = from; s < toExcl; s = addDays(s, 14)) {
    const e = addDays(s, 14) < toExcl ? addDays(s, 14) : toExcl;
    const r = await call("POST", `${BASE}/total-calories/dataPoints:dailyRollUp`, { range: { start: civil(s), end: civil(e) } });
    cal.push({ range: [s, e], status: r.status, json: r.json });
  }
  save("total-calories-dailyrollup-30d.json", cal);
  console.log("total-calories dailyRollUp:", cal.map((c) => c.status).join(","));

  // Pick the HR/energy window workout: one that starts on 2026-11-03 (civil), else the most recent.
  const withMeta = points.map((p) => {
    const startT = find(p, "startTime") as string | undefined;
    const endT = find(p, "endTime") as string | undefined;
    return { p, start: startT, end: endT, day: localDay(p) };
  }).filter((x) => x.start && x.end);
  withMeta.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  // Prefer 2026-11-03 (known AZM 8); among its workouts take the longest actively measured one.
  const dur = (x: { p: Json }) => Number(String(find(x.p, "activeDuration") ?? "0").replace("s", ""));
  const onDay = withMeta.filter((x) => x.day === "2026-11-03" && find(x.p, "recordingMethod") === "ACTIVELY_MEASURED").sort((a, b) => dur(b) - dur(a));
  const pick = onDay[0] ?? withMeta[withMeta.length - 1];
  if (!pick) { console.log("no workout with a start/end time found; stopping"); process.exit(0); }
  console.log(`window workout: local day ${pick.day}, type ${String(find(pick.p, "exerciseType"))}, picked ${pick.day === "2026-11-03" ? "the 2026-11-03 workout" : "the most recent workout (none on 2026-11-03)"}`);
  const w0 = pick.start as string, w1 = pick.end as string;

  // 3. active-energy-burned for the workout window.
  let ae = await list("active-energy-burned", `active_energy_burned.interval.start_time >= "${w0}" AND active_energy_burned.interval.start_time < "${w1}"`);
  let aeFilter = "active_energy_burned.interval.start_time (physical)";
  if (ae.status === 400) {
    const ct = find(pick.p, "civilStartTime") as { date?: { year: number; month: number; day: number }; time?: { hours?: number; minutes?: number; seconds?: number } } | undefined;
    const ce = find(pick.p, "civilEndTime") as typeof ct;
    const dt = (c: typeof ct) => c?.date ? `${c.date.year}-${String(c.date.month).padStart(2, "0")}-${String(c.date.day).padStart(2, "0")}T${String(c.time?.hours ?? 0).padStart(2, "0")}:${String(c.time?.minutes ?? 0).padStart(2, "0")}:${String(c.time?.seconds ?? 0).padStart(2, "0")}` : null;
    const a = dt(ct), b = dt(ce);
    if (a && b) { ae = await list("active-energy-burned", `active_energy_burned.interval.civil_start_time >= "${a}" AND active_energy_burned.interval.civil_start_time < "${b}"`); aeFilter = "active_energy_burned.interval.civil_start_time (fallback after 400 on physical)"; }
  }
  save("active-energy-burned-workout-window.json", { window: [w0, w1], filter: aeFilter, httpStatus: ae.status, pages: ae.pages });
  console.log(`active-energy-burned: HTTP ${ae.status}`);

  // 4. heart-rate for the workout window (same filter + reconcile the sync uses).
  const hrPages: Json[] = [];
  let hrStatus = 200, pt: string | undefined;
  for (let i = 0; i < 20; i++) {
    const p = new URLSearchParams({ filter: `heart_rate.sample_time.physical_time >= "${w0}" AND heart_rate.sample_time.physical_time < "${w1}"`, pageSize: "1000" });
    if (pt) p.set("pageToken", pt);
    const r = await call("GET", `${BASE}/heart-rate/dataPoints:reconcile?${p}`);
    hrPages.push(r.json); hrStatus = r.status;
    if (r.status !== 200) break;
    pt = (r.json as { nextPageToken?: string }).nextPageToken;
    if (!pt) break;
  }
  save("heart-rate-workout-window.json", { window: [w0, w1], httpStatus: hrStatus, pages: hrPages });
  console.log(`heart-rate: HTTP ${hrStatus}, ${hrPages.flatMap((p) => ((p as { dataPoints?: Json[] }).dataPoints ?? [])).length} samples`);

  // 5. Count of workouts over the DB-covered history range (activity rows start 2026-03-21). Summary only.
  const all = await list("exercise", `exercise.interval.civil_start_time >= "2026-03-21" AND exercise.interval.civil_start_time < "${toExcl}"`);
  const allPts = all.pages.flatMap((p) => ((p as { dataPoints?: Json[] }).dataPoints ?? []));
  const byMonth: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  for (const p of allPts) {
    const d = localDay(p) ?? "unknown";
    byMonth[d.slice(0, 7)] = (byMonth[d.slice(0, 7)] ?? 0) + 1;
    const t = String(find(p, "exerciseType") ?? find(p, "activityType") ?? "unknown"); byType[t] = (byType[t] ?? 0) + 1;
    const m = String(find(p, "recordingMethod") ?? "unknown"); byMethod[m] = (byMethod[m] ?? 0) + 1;
  }
  save("exercise-history-summary.json", { range: ["2026-03-21", today], httpStatus: all.status, pages: all.pages.length, workouts: allPts.length, byMonth, byType, byMethod });
  console.log(`history 2026-03-21..${today}: HTTP ${all.status}, ${allPts.length} workouts`);
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
