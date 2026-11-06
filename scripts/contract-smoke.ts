// Contract smoke test for /api/v1 — part of `npm run check`.
//   - Skipped (exit 0, loud message) when TINA_API_TOKEN is absent.
//   - Starts nothing: expects `npm run dev` to be running (TINA_API_URL, default http://127.0.0.1:3100).
//     With a token set, an unreachable server is a FAILURE (only a missing token skips);
//     set TINA_SMOKE_SKIP_UNREACHABLE=1 to opt out.
//   - READ-ONLY. It never calls POST /api/v1/sync and never writes to the database; the
//     dashboard-score comparison reads Postgres only.
//   - Never prints the token.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import {
  MAX_RANGE_DAYS,
  SCHEMA_DOC,
  validateAgainstDoc,
  validateEnvelope,
  validateMetricShapes,
  walkFields,
  type Json,
} from "@/lib/api";
import { addDays, localToday } from "@/lib/dates";

const TOKEN = process.env.TINA_API_TOKEN;
const BASE = (process.env.TINA_API_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const SKIP_UNREACHABLE = process.env.TINA_SMOKE_SKIP_UNREACHABLE === "1";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string): void {
  checks += 1;
  if (!cond) failures.push(msg);
}

interface Reply { status: number; json: Json }

async function get(path: string, token: string | null = TOKEN ?? null): Promise<Reply> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(60_000),
    });
    return { status: res.status, json: (await res.json()) as Json };
  } catch (e) {
    // A non-JSON body (e.g. an HTML 500 page) or a network error is a failed check, not a crash that hides earlier results.
    failures.push(`GET ${path}: ${e instanceof Error ? e.message : "request failed"}`);
    return { status: 0, json: null };
  }
}

/** Unwraps a success envelope, recording any envelope violations. */
function ok(name: string, r: Reply): Json | null {
  const env = validateEnvelope(r.json);
  for (const e of env.errors) failures.push(`${name}: ${e}`);
  expect(r.status === 200, `${name}: expected HTTP 200, got ${r.status}`);
  expect(env.data !== null, `${name}: expected a success envelope`);
  return env.data;
}

function dayChecks(name: string, day: Json | null): void {
  if (day === null) return;
  for (const e of validateMetricShapes(day)) failures.push(`${name}: ${e}`);
  for (const e of validateAgainstDoc(name, SCHEMA_DOC.responses.day, [day], { requireAll: false })) failures.push(e);
  checks += 2;
  const azm = (day as { activeZoneMinutes?: { status?: string; reason?: string; unit?: string; value?: unknown; flags?: string[] } }).activeZoneMinutes;
  const azmOk = azm?.status === "derived" ? azm.unit === "min" && typeof azm.value === "number" && Number.isFinite(azm.value) && azm.value >= 0
    : azm?.status === "unavailable" && typeof azm.reason === "string" && azm.reason !== "not_supported" && !("value" in azm);
  const isToday = (day as { date?: string }).date === localToday();
  if (isToday && azm?.status === "derived" && !azm.flags?.includes("partial_day")) failures.push(`${name}: today's activeZoneMinutes must carry the partial_day flag`);
  if (!azmOk) failures.push(`${name}: activeZoneMinutes must be derived (non-negative number, unit min) or unavailable with a reason other than not_supported`);
  checks += 1;
}

type Obj = { [k: string]: Json };

/** Every metric object (status measured/estimated/derived/unavailable) anywhere inside a payload. */
function collectMetrics(v: Json): Obj[] {
  if (Array.isArray(v)) return v.flatMap(collectMetrics);
  if (v !== null && typeof v === "object") {
    const o = v as Obj;
    if (typeof o.status === "string" && ["measured", "estimated", "derived", "unavailable"].includes(o.status)) return [o];
    return Object.values(o).flatMap(collectMetrics);
  }
  return [];
}
const asObj = (v: Json | null | undefined): Obj => (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

async function main(): Promise<void> {
  if (!TOKEN) {
    console.log("contract-smoke: SKIPPED — TINA_API_TOKEN is not set (create a token with scripts/create-api-token.ts and put it in .env.local).");
    return;
  }
  try {
    await fetch(`${BASE}/api/v1/schema`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    const msg = `contract-smoke: dev server not reachable at ${BASE} — start it with \`npm run dev\`.`;
    if (!SKIP_UNREACHABLE) throw new Error(msg);
    console.log(`${msg} SKIPPED (TINA_SMOKE_SKIP_UNREACHABLE=1).`);
    return;
  }

  if (!/^https:\/\//.test(BASE) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)) {
    throw new Error("contract-smoke: refusing to send the token over plain http to a non-local host; use https.");
  }

  const today = localToday();
  const yesterday = addDays(today, -1);

  // Auth: no token and a garbage token are refused with the failure envelope.
  for (const [label, token] of [["no token", null], ["bad token", "tina_not-a-real-token"]] as const) {
    const r = await get("/api/v1/state", token);
    const env = validateEnvelope(r.json);
    expect(r.status === 401 && env.errorCode === "unauthorized", `auth (${label}): expected 401 unauthorized, got ${r.status}/${env.errorCode}`);
  }

  // schema
  const schema = ok("schema", await get("/api/v1/schema"));
  expect(asObj(schema).apiVersion === "1" && Array.isArray(asObj(schema).endpoints), "schema: has apiVersion and endpoints");
  expect(Object.keys(asObj(schema)).sort().join() === Object.keys(SCHEMA_DOC).sort().join(), "schema: top-level keys match the contract");

  // state
  const state = ok("state", await get("/api/v1/state"));
  if (state !== null) {
    for (const e of validateMetricShapes(state)) failures.push(`state: ${e}`);
    for (const e of validateAgainstDoc("state", SCHEMA_DOC.responses.state, [state], { requireAll: true })) failures.push(e);
    checks += 2;
  }

  // day: today and yesterday
  dayChecks("day(today)", ok("day(today)", await get(`/api/v1/day?date=${today}`)));
  dayChecks("day(yesterday)", ok("day(yesterday)", await get(`/api/v1/day?date=${yesterday}`)));

  // day: before synced history begins → unavailable with a reason, never a 0
  const ancient = ok("day(2000-01-01)", await get("/api/v1/day?date=2000-01-01"));
  dayChecks("day(2000-01-01)", ancient);
  if (ancient !== null) {
    const metrics = collectMetrics(ancient);
    expect(metrics.length > 0, "day(2000-01-01): has metrics");
    expect(
      metrics.every((m) => m.status === "unavailable" && typeof m.reason === "string" && !("value" in m)),
      "day(2000-01-01): every metric is unavailable with a reason and no value (never a 0)",
    );
    expect(walkFields(ancient).every((f) => f.isMetric || typeof f.value !== "number"), "day(2000-01-01): no plain numeric field on a date with no data");
    expect(asObj(asObj(asObj(ancient).sleep).main).status === "unavailable", "day(2000-01-01): sleep.main is unavailable");
    for (const key of ["restingHeartRate", "hrv", "steps", "activeZoneMinutes"]) {
      const m = asObj(asObj(ancient)[key]);
      expect(m.status === "unavailable" && typeof m.reason === "string", `day(2000-01-01): ${key} is unavailable with a reason`);
    }
  }

  // bad date parameter
  const bad = validateEnvelope((await get("/api/v1/day?date=not-a-date")).json);
  expect(bad.errorCode === "invalid_parameter", `day(bad date): expected invalid_parameter, got ${bad.errorCode}`);

  // days: 7-day range
  const week = ok("days(7)", await get(`/api/v1/days?from=${addDays(today, -6)}&to=${today}`));
  const weekDays = asObj(week).days;
  expect(Array.isArray(weekDays) && weekDays.length === 7, "days(7): returns 7 days");
  expect(Array.isArray(weekDays) && weekDays.every((d, i) => asObj(d).date === addDays(today, -6 + i)), "days(7): ascending consecutive dates");
  for (const e of validateAgainstDoc("days(7)", SCHEMA_DOC.responses.days, [{ from: asObj(week).from ?? null, to: asObj(week).to ?? null }], { requireAll: false })) failures.push(e);
  if (Array.isArray(weekDays)) weekDays.forEach((d, i) => dayChecks(`days(7)[${i}]`, d));

  // days: over the cap
  const over = await get(`/api/v1/days?from=${addDays(today, -MAX_RANGE_DAYS)}&to=${today}`);
  const overEnv = validateEnvelope(over.json);
  expect(over.status === 400 && overEnv.errorCode === "range_too_large" && overEnv.errors.length === 0, `days(over cap): expected 400 range_too_large, got ${over.status}/${overEnv.errorCode}`);
  const cap = await get(`/api/v1/days?from=${addDays(today, -(MAX_RANGE_DAYS - 1))}&to=${today}`);
  const capData = ok(`days(exactly ${MAX_RANGE_DAYS})`, cap);
  const capDays = asObj(capData).days;
  expect(Array.isArray(capDays) && capDays.length === MAX_RANGE_DAYS, `days(exactly ${MAX_RANGE_DAYS}): returns ${MAX_RANGE_DAYS} days`);
  if (Array.isArray(capDays)) capDays.forEach((d, i) => dayChecks(`days(${MAX_RANGE_DAYS})[${i}]`, d));

  // Sleep score of 3 recent nights equals the dashboard's (dashboard computed straight from Postgres, read-only).
  await compareScores(today);

  report();
}

async function compareScores(today: string): Promise<void> {
  const { db } = await import("@/db/client");
  const { users, sleepSessions, heartRateSummaries, heartRateSamples } = await import("@/db/schema");
  const { assembleDashboardData } = await import("@/lib/sync/assemble");
  const { selectMainSessions } = await import("@/lib/analytics/sleep");

  const range = ok("days(30)", await get(`/api/v1/days?from=${addDays(today, -29)}&to=${today}`));
  const days = asObj(range).days;
  expect(Array.isArray(days), "days(30): data.days is an array");
  if (!Array.isArray(days)) return;
  days.forEach((d, i) => dayChecks(`days(30)[${i}]`, d));
  const [user] = await db.select({ id: users.id }).from(users);

  // Nights with a stored-sample cache (>=10 samples): for those the dashboard never needs Google,
  // so its score is reproducible from the database alone.
  const MIN_SAMPLES = 10;
  const compared: string[] = [];
  for (const d of [...days].reverse()) {
    if (compared.length === 3) break;
    const main = asObj(asObj(asObj(d).sleep).main);
    const score = asObj(main.score);
    if (main.status !== "recorded" || score.status !== "derived") continue;
    const date = String(asObj(d).date);

    // The same session/heart/sample queries readDashboardData(targetDate) runs (the unscoped current-state/chart
    // rows it also passes do not influence holisticScore, so they are not reproduced).
    const hist = await db.query.sleepSessions.findMany({
      where: and(eq(sleepSessions.userId, user.id), lt(sleepSessions.sleepDate, date)),
      orderBy: [desc(sleepSessions.sleepDate)], limit: 90, with: { stages: true },
    });
    const hr = await db.query.heartRateSummaries.findMany({
      where: and(eq(heartRateSummaries.userId, user.id), lte(heartRateSummaries.date, date)),
      orderBy: [desc(heartRateSummaries.date)], limit: 45,
    });
    const shown = selectMainSessions(hist)[0];
    const samples = shown
      ? await db.query.heartRateSamples.findMany({
          where: and(eq(heartRateSamples.userId, user.id), gte(heartRateSamples.timestamp, shown.startTime), lte(heartRateSamples.timestamp, shown.endTime)),
          orderBy: [asc(heartRateSamples.timestamp)],
        })
      : [];
    if (samples.length < MIN_SAMPLES) continue;

    const dash = assembleDashboardData(
      hist,
      hr.map((r) => ({ date: r.date, restingHeartRate: r.restingHeartRate, hrvRmssd: r.hrvRmssd })),
      samples.map((s) => ({ timestamp: s.timestamp, bpm: s.bpm })),
      8,
      hist,
      hist,
    );
    const dashScore = dash.hasData ? dash.lastNight?.holisticScore ?? null : null;
    expect(dashScore !== null && score.value === dashScore, `score(${date}): API ${String(score.value)} vs dashboard ${String(dashScore)}`);
    compared.push(date);
  }
  expect(
    compared.length === 3,
    `score: INSUFFICIENT DATA (not a mismatch): needed 3 recent recorded nights with >= ${MIN_SAMPLES} cached HR samples in the last 30 days, found ${compared.length}; open those nights in the dashboard to cache their samples`,
  );
  console.log(`contract-smoke: dashboard score parity checked for nights keyed by day ${compared.join(", ")}`);
}

function report(): void {
  if (failures.length > 0) {
    console.error(`contract-smoke: FAILED (${failures.length} of ${checks} checks)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`contract-smoke: ${checks} checks passed`);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
