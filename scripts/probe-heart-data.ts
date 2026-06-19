/**
 * ONE-OFF PROBE — delete after investigation. No DB writes, no persist calls,
 * no routes. Read-only query of Google Health Connect v4 for non-sleep heart
 * data types available on this account (Fitbit Charge 6).
 *
 * Run: npx tsx scripts/probe-heart-data.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGoogleValidClientToken } from "@/lib/google/client";
import { localToday, addDays } from "@/lib/dates";

const USER_EMAIL = "gisete@gmail.com";
const BASE       = "https://health.googleapis.com/v4/users/me/dataTypes";

// ---------------------------------------------------------------------------
// Types — no `any`; explicit interfaces + unknown narrowing for response bodies
// ---------------------------------------------------------------------------

interface GApiError {
  code:    number;
  message: string;
  status:  string;
}

interface GApiBody {
  dataPoints?:    unknown[];
  error?:         GApiError;
  nextPageToken?: string;
}

type Cadence = "daily" | "intraday";

interface CandidateConfig {
  name:    string;
  /** IDs tried in order; first 200 response wins. */
  ids:     [string, ...string[]];
  cadence: Cadence;
}

interface ProbeOutcome {
  idUsed:     string;
  reconcile:  boolean;
  httpStatus: number;
  count:      number;
  errorCode:  string | null;
  errorMsg:   string | null;
  sampleKeys: string[];
}

// ---------------------------------------------------------------------------
// Candidate types to probe
// ---------------------------------------------------------------------------

const CANDIDATES: CandidateConfig[] = [
  // Sanity checks — already synced; should return data
  { name: "Resting HR (daily)",        ids: ["daily-resting-heart-rate"],                                                                    cadence: "daily"    },
  { name: "HRV RMSSD (daily)",         ids: ["daily-heart-rate-variability"],                                                                cadence: "daily"    },
  // New candidates
  { name: "Active zone minutes",       ids: ["active-zone-minutes", "active-minutes"],                                                       cadence: "daily"    },
  { name: "Calories in HR zone",       ids: ["calories-in-heart-rate-zone", "calories-in-zone"],                                             cadence: "daily"    },
  { name: "Daily HR zones",            ids: ["daily-heart-rate-zones", "heart-rate-zones"],                                                  cadence: "daily"    },
  { name: "Time in HR zone",           ids: ["time-in-heart-rate-zones", "heart-rate-zone-time", "time-in-zone"],                           cadence: "daily"    },
  { name: "Cardio fitness / VO2 max",  ids: ["cardio-fitness", "vo2-max", "aerobic-capacity"],                                              cadence: "daily"    },
  { name: "Irregular rhythm / AFib",   ids: ["atrial-fibrillation-burden", "irregular-heart-rhythm-status", "irregular-rhythm-notification"], cadence: "daily"   },
  // Intraday — bound to ONE day to avoid a large pull
  { name: "Intraday HR (1 day)",       ids: ["heart-rate"],                                                                                 cadence: "intraday" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Kebab data-type ID → snake_case filter-field prefix, matching the API convention. */
function snake(id: string): string {
  return id.replace(/-/g, "_");
}

/** Daily filter: {snake_id}.date >= "YYYY-MM-DD" AND {snake_id}.date < "YYYY-MM-DD" */
function dailyFilter(id: string, from: string, toExcl: string): string {
  const s = snake(id);
  return `${s}.date >= "${from}" AND ${s}.date < "${toExcl}"`;
}

/** Intraday filter: {snake_id}.sample_time.physical_time >= "ISO" AND ... < "ISO" */
function intradayFilter(id: string, fromISO: string, toISO: string): string {
  const s = snake(id);
  return `${s}.sample_time.physical_time >= "${fromISO}" AND ${s}.sample_time.physical_time < "${toISO}"`;
}

/**
 * Single raw probe attempt — never throws. Returns a ProbeOutcome with httpStatus=0
 * on network-level failures.
 */
async function rawProbe(
  token:     string,
  id:        string,
  reconcile: boolean,
  filter:    string | null,
  pageSize?: number,
): Promise<ProbeOutcome> {
  const suffix = reconcile ? "dataPoints:reconcile" : "dataPoints";
  const params = new URLSearchParams();
  if (filter)   params.set("filter",   filter);
  if (pageSize) params.set("pageSize", String(pageSize));
  const qs  = params.toString();
  const url = `${BASE}/${id}/${suffix}${qs ? `?${qs}` : ""}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (e) {
    return {
      idUsed: id, reconcile, httpStatus: 0, count: 0,
      errorCode: "NETWORK_ERROR", errorMsg: String(e), sampleKeys: [],
    };
  }

  let body: GApiBody | null = null;
  try {
    const raw: unknown = await response.json();
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      body = raw as GApiBody;
    }
  } catch { /* leave null — non-JSON body */ }

  if (!response.ok) {
    return {
      idUsed: id, reconcile,
      httpStatus: response.status, count: 0,
      errorCode: body?.error?.status ?? `HTTP_${response.status}`,
      errorMsg:  body?.error?.message ?? "(no message)",
      sampleKeys: [],
    };
  }

  const pts        = Array.isArray(body?.dataPoints) ? (body!.dataPoints as unknown[]) : [];
  const sampleKeys = pts.length > 0
    ? Object.keys(pts[0] as Record<string, unknown>)
    : [];

  return { idUsed: id, reconcile, httpStatus: 200, count: pts.length, errorCode: null, errorMsg: null, sampleKeys };
}

/**
 * Probes one candidate: iterates through its ID list, trying reconcile=true then
 * reconcile=false for each ID. On INVALID_ARGUMENT (likely a wrong filter field),
 * also probes without a filter at pageSize=1 to confirm the type at least exists.
 * Returns the first 200 outcome, or the last failure if all attempts fail.
 */
async function probeCandidate(
  token:        string,
  cand:         CandidateConfig,
  dailyFrom:    string,
  dailyToExcl:  string,
  intradayFrom: string,
  intradayTo:   string,
): Promise<ProbeOutcome> {
  let lastOutcome: ProbeOutcome | null = null;

  for (const id of cand.ids) {
    const filter = cand.cadence === "daily"
      ? dailyFilter(id, dailyFrom, dailyToExcl)
      : intradayFilter(id, intradayFrom, intradayTo);

    const pageSz = cand.cadence === "intraday" ? 200 : undefined;

    // Attempt 1: reconcile=true (convention used by both daily and intraday in this codebase)
    let o = await rawProbe(token, id, true, filter, pageSz);
    if (o.httpStatus === 200) return o;
    lastOutcome = o;

    // Attempt 2: reconcile=false (some types reject the :reconcile suffix)
    o = await rawProbe(token, id, false, filter, pageSz);
    if (o.httpStatus === 200) return o;
    lastOutcome = o;

    // Attempt 3: if the filter field itself is wrong (INVALID_ARGUMENT), probe
    // without any filter and pageSize=1 — confirms type exists even if we can't
    // yet form the correct filter expression.
    if (lastOutcome.errorCode === "INVALID_ARGUMENT") {
      o = await rawProbe(token, id, true, null, 1);
      if (o.httpStatus === 200) {
        return { ...o, errorMsg: "filter-field rejected; re-probed existence only (pageSize=1)" };
      }
      // Don't clobber lastOutcome — keep the filter error for the final report.
    }
  }

  // All variants exhausted.
  return lastOutcome ?? {
    idUsed: cand.ids[0], reconcile: true, httpStatus: 0, count: 0,
    errorCode: "NO_ATTEMPTS", errorMsg: null, sampleKeys: [],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("probe-heart-data — Google Health v4 non-sleep heart data types");
  console.log("=".repeat(72) + "\n");

  // User + token
  const user = await db.query.users.findFirst({ where: eq(users.email, USER_EMAIL) });
  if (!user) { console.error(`User not found: ${USER_EMAIL}`); process.exit(1); }
  console.log(`User: ${user.id}  (${USER_EMAIL})`);
  const token = await getGoogleValidClientToken(user.id);
  console.log("Token ready.\n");

  // Date ranges — built with local-timezone helpers, never toISOString()
  const today       = localToday();
  const dailyFrom   = addDays(today, -13);   // 14-day window (today inclusive)
  const dailyToExcl = addDays(today,   1);   // exclusive upper bound for daily filter
  // Intraday: yesterday 00:00Z → today 00:00Z (24-hour UTC window — plenty for existence check)
  const intradayFrom = `${addDays(today, -1)}T00:00:00Z`;
  const intradayTo   = `${today}T00:00:00Z`;

  console.log(`Daily window  : ${dailyFrom} → ${today}  (excl. upper bound ${dailyToExcl})`);
  console.log(`Intraday day  : ${addDays(today, -1)}  (UTC midnight → midnight)\n`);

  type RowAccum = { name: string; outcome: ProbeOutcome; cadence: Cadence };
  const rows: RowAccum[] = [];

  // ---------------------------------------------------------------------------
  // Probe loop
  // ---------------------------------------------------------------------------

  for (const cand of CANDIDATES) {
    process.stdout.write(`▸ ${cand.name.padEnd(28)} ...`);
    const outcome = await probeCandidate(token, cand, dailyFrom, dailyToExcl, intradayFrom, intradayTo);
    const tag =
      outcome.httpStatus === 200 && outcome.count > 0  ? "YES  " :
      outcome.httpStatus === 200 && outcome.count === 0 ? "EMPTY" :
                                                          "ERROR";
    console.log(` ${tag}`);

    console.log(`  ID used     : ${outcome.idUsed}  (reconcile=${outcome.reconcile})`);
    if (outcome.httpStatus === 200) {
      console.log(`  Points      : ${outcome.count}`);
      if (outcome.sampleKeys.length > 0) {
        console.log(`  Sample keys : ${outcome.sampleKeys.join(", ")}`);
      } else {
        console.log(`  Sample keys : (empty — no points returned)`);
      }
      if (outcome.errorMsg) {
        console.log(`  Note        : ${outcome.errorMsg}`);
      }
    } else {
      console.log(`  HTTP status : ${outcome.httpStatus}`);
      console.log(`  Error code  : ${outcome.errorCode}`);
      console.log(`  Error msg   : ${outcome.errorMsg}`);
    }
    console.log();

    rows.push({ name: cand.name, outcome, cadence: cand.cadence });
  }

  // ---------------------------------------------------------------------------
  // Summary table
  // ---------------------------------------------------------------------------

  console.log("=".repeat(72));
  console.log("SUMMARY TABLE");
  console.log("  * Trendable = one-per-day AND data present over the 14-day window.");
  console.log("=".repeat(72));
  console.log();

  const col = (s: string, w: number) => s.padEnd(w).slice(0, w);
  const HDR = col("Metric", 28) + col("Available", 10) + col("Cadence",  10) + col("Trendable*", 12) + "ID used";
  console.log(HDR);
  console.log("-".repeat(HDR.length + 10));

  for (const { name, outcome, cadence } of rows) {
    const available =
      outcome.httpStatus === 200 && outcome.count > 0  ? "yes"   :
      outcome.httpStatus === 200 && outcome.count === 0 ? "empty" :
                                                          "error";
    const trendable = available === "yes" && cadence === "daily" ? "yes" : "no";

    console.log(
      col(name, 28) +
      col(available, 10) +
      col(cadence,   10) +
      col(trendable, 12) +
      outcome.idUsed,
    );
  }

  // ---------------------------------------------------------------------------
  // Deep-dive: daily-heart-rate-zones record shape (last 3 days)
  // ---------------------------------------------------------------------------

  console.log("=".repeat(72));
  console.log("DAILY-HEART-RATE-ZONES — raw record shape (last 3 days)");
  console.log("=".repeat(72) + "\n");

  const zoneFrom   = addDays(today, -3);
  const zoneToExcl = addDays(today,  1);
  const zoneFilter = `daily_heart_rate_zones.date >= "${zoneFrom}" AND daily_heart_rate_zones.date < "${zoneToExcl}"`;
  const zoneUrl    = `${BASE}/daily-heart-rate-zones/dataPoints:reconcile?filter=${encodeURIComponent(zoneFilter)}&pageSize=3`;

  let zoneResponse: Response;
  try {
    zoneResponse = await fetch(zoneUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (e) {
    console.error("Network error fetching zones:", e);
    process.exit(1);
  }

  const zoneBodyRaw: unknown = await zoneResponse.json();
  console.log("RAW JSON:\n" + JSON.stringify(zoneBodyRaw, null, 2) + "\n");

  // ---------------------------------------------------------------------------
  // Structured analysis of the zone records
  // ---------------------------------------------------------------------------

  if (
    zoneBodyRaw !== null &&
    typeof zoneBodyRaw === "object" &&
    !Array.isArray(zoneBodyRaw) &&
    "dataPoints" in zoneBodyRaw &&
    Array.isArray((zoneBodyRaw as Record<string, unknown>).dataPoints)
  ) {
    const pts = (zoneBodyRaw as { dataPoints: unknown[] }).dataPoints;
    console.log("=".repeat(72));
    console.log("ZONE SHAPE ANALYSIS");
    console.log("=".repeat(72) + "\n");

    // Collect all zone objects found across all records
    type ZoneRecord = Record<string, unknown>;
    const allZoneObjects: ZoneRecord[] = [];
    const zoneNamesFound = new Set<string>();

    for (const pt of pts) {
      if (pt === null || typeof pt !== "object" || Array.isArray(pt)) continue;
      const rec = pt as ZoneRecord;
      const payload = rec["dailyHeartRateZones"];
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) continue;
      const payloadObj = payload as ZoneRecord;
      // Zones may be a direct object or an array field
      const zonesField = payloadObj["zones"] ?? payloadObj["heartRateZones"] ?? payloadObj["zone"];
      if (Array.isArray(zonesField)) {
        for (const z of zonesField) {
          if (z !== null && typeof z === "object" && !Array.isArray(z)) {
            const zo = z as ZoneRecord;
            allZoneObjects.push(zo);
            const name = zo["name"] ?? zo["zoneName"] ?? zo["type"] ?? "(unnamed)";
            zoneNamesFound.add(String(name));
          }
        }
      } else {
        // payload itself may have per-zone keys at the top level
        const payloadKeys = Object.keys(payloadObj);
        console.log("Top-level payload keys:", payloadKeys.join(", "));
      }
    }

    if (allZoneObjects.length > 0) {
      // Union of all field names across zone objects
      const allFields = new Set<string>();
      for (const zo of allZoneObjects) Object.keys(zo).forEach((k) => allFields.add(k));

      // Classify fields
      const durationFields  = [...allFields].filter((k) => /minute|second|duration|time|count/i.test(k));
      const thresholdFields = [...allFields].filter((k) => /min|max|bpm|threshold|boundary/i.test(k));
      const calFields       = [...allFields].filter((k) => /calori/i.test(k));
      const otherFields     = [...allFields].filter(
        (k) => !durationFields.includes(k) && !thresholdFields.includes(k) && !calFields.includes(k),
      );

      console.log("Zone names found   :", zoneNamesFound.size > 0 ? [...zoneNamesFound].join(", ") : "(none)");
      console.log("All zone fields    :", [...allFields].join(", "));
      console.log("Duration fields    :", durationFields.length  > 0 ? durationFields.join(", ")  : "(none)");
      console.log("Threshold fields   :", thresholdFields.length > 0 ? thresholdFields.join(", ") : "(none)");
      console.log("Calorie fields     :", calFields.length       > 0 ? calFields.join(", ")       : "(none)");
      console.log("Other fields       :", otherFields.length     > 0 ? otherFields.join(", ")     : "(none)");
      console.log();

      const hasTime       = durationFields.length  > 0;
      const hasThreshold  = thresholdFields.length > 0;
      const verdict =
        hasTime && hasThreshold ? "BOTH"            :
        hasTime                 ? "TIME-IN-ZONE"    :
        hasThreshold            ? "THRESHOLDS-ONLY" :
                                  "UNKNOWN (no duration or threshold fields detected)";
      console.log("VERDICT:", verdict);
    } else {
      console.log("No zone sub-objects found — payload structure differs from expected.");
      console.log("Inspect the raw JSON above to determine field names manually.");
    }
  } else {
    console.log("Response did not contain a dataPoints array — inspect raw JSON above.");
  }

  // ---------------------------------------------------------------------------
  // Re-probe previously-failing activity types — exact HTTP status + error body
  // ---------------------------------------------------------------------------

  console.log("=".repeat(72));
  console.log("RE-PROBE — activity-type candidates (corrected kebab IDs)");
  console.log("=".repeat(72) + "\n");

  interface ReprobeTarget {
    label:       string;
    id:          string;
    filterField: string;
    /** Override the action used (default: reconcile → list fallback). */
    action?: "reconcile" | "rollup" | "dailyRollup";
  }

  const REPROBE: ReprobeTarget[] = [
    { label: "Active zone minutes",      id: "active-zone-minutes",         filterField: "active_zone_minutes"         },
    { label: "VO2 max (generic)",        id: "vo2-max",                     filterField: "vo2_max"                     },
    { label: "VO2 max (daily)",          id: "daily-vo2-max",               filterField: "daily_vo2_max"               },
    { label: "VO2 max (run)",            id: "run-vo2-max",                 filterField: "run_vo2_max"                 },
    { label: "Time in HR zone",          id: "time-in-heart-rate-zone",     filterField: "time_in_heart_rate_zone"     },
    { label: "Calories in HR zone (rollup)", id: "calories-in-heart-rate-zone", filterField: "calories_in_heart_rate_zone", action: "rollup" },
  ];

  const reFrom   = addDays(today, -13);
  const reToExcl = addDays(today,   1);

  /** Reusable fetch-and-parse helper — never throws. */
  async function reprobe(
    id: string, action: string, filter: string | null, pageSize = 1,
  ): Promise<{ status: number; errorStatus: string; errorMsg: string; points: number }> {
    const params = new URLSearchParams();
    if (filter)   params.set("filter",   filter);
    if (pageSize) params.set("pageSize", String(pageSize));
    const qs  = params.toString();
    const url = `${BASE}/${id}/dataPoints:${action}${qs ? `?${qs}` : ""}`;

    let resp: Response;
    try {
      resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    } catch (e) {
      return { status: 0, errorStatus: "NETWORK_ERROR", errorMsg: String(e), points: 0 };
    }

    let body: unknown = null;
    try { body = await resp.json(); } catch { /* non-JSON */ }

    if (!resp.ok) {
      let errorStatus = "";
      let errorMsg    = "";
      if (body !== null && typeof body === "object" && !Array.isArray(body) && "error" in body) {
        const err = (body as Record<string, unknown>)["error"];
        if (err !== null && typeof err === "object" && !Array.isArray(err)) {
          const e = err as Record<string, unknown>;
          errorStatus = typeof e["status"]  === "string" ? e["status"]  : "";
          errorMsg    = typeof e["message"] === "string" ? e["message"] : "";
        }
      }
      return { status: resp.status, errorStatus, errorMsg, points: 0 };
    }

    const pts = (body !== null && typeof body === "object" && !Array.isArray(body) && "dataPoints" in body)
      ? (body as Record<string, unknown[]>)["dataPoints"]
      : [];
    return { status: 200, errorStatus: "", errorMsg: "", points: Array.isArray(pts) ? pts.length : 0 };
  }

  for (const t of REPROBE) {
    const filter = `${t.filterField}.date >= "${reFrom}" AND ${t.filterField}.date < "${reToExcl}"`;
    console.log(`${t.label}  [${t.id}]`);

    if (t.action === "rollup") {
      // calories-in-heart-rate-zone only supports rollup/dailyRollup
      for (const act of ["rollup", "dailyRollup"] as const) {
        const r = await reprobe(t.id, act, filter);
        console.log(`  :${act.padEnd(12)} → ${r.status === 200 ? `200 OK  pts=${r.points}` : `${r.status} ${r.errorStatus}  ${r.errorMsg}`}`);
      }
    } else {
      // Standard path: reconcile → list, each with filter; then no-filter existence check on failure
      const withFilter = [
        await reprobe(t.id, "reconcile", filter),
        await reprobe(t.id, "reconcile", null, 1),  // no-filter existence check
      ];
      const [filtered, noFilter] = withFilter;
      console.log(`  :reconcile (filter)  → ${filtered.status === 200 ? `200 OK  pts=${filtered.points}` : `${filtered.status} ${filtered.errorStatus}  ${filtered.errorMsg}`}`);
      console.log(`  :reconcile (no-filt) → ${noFilter.status === 200 ? `200 OK  pts=${noFilter.points}` : `${noFilter.status} ${noFilter.errorStatus}  ${noFilter.errorMsg}`}`);

      // If no-filter also fails, try bare list
      if (noFilter.status !== 200) {
        const bare = await reprobe(t.id, "list" as string, null, 1);
        console.log(`  :list      (no-filt) → ${bare.status === 200 ? `200 OK  pts=${bare.points}` : `${bare.status} ${bare.errorStatus}  ${bare.errorMsg}`}`);
      }
    }
    console.log();
  }

  // ---------------------------------------------------------------------------
  // dailyRollUp probe — active-zone-minutes + time-in-heart-rate-zone
  // ---------------------------------------------------------------------------

  console.log("=".repeat(72));
  console.log("dailyRollUp PROBE — active-zone-minutes + time-in-heart-rate-zone");
  console.log("=".repeat(72) + "\n");

  const rollFrom   = addDays(today, -13);
  const rollToExcl = addDays(today,   1);

  // The raw record showed civilStartTime.date — try that as the filter member.
  // Also try with no filter to see if pagination alone handles 14 days.
  const ROLLUP_TYPES: Array<{ id: string; filterField: string }> = [
    { id: "active-zone-minutes",     filterField: "active_zone_minutes"      },
    { id: "time-in-heart-rate-zone", filterField: "time_in_heart_rate_zone"  },
  ];

  for (const rt of ROLLUP_TYPES) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`TYPE: ${rt.id}`);
    console.log(`${"─".repeat(60)}`);

    // dailyRollUp and rollUp are POST methods with a JSON body (not GET with query params).
    // Date body uses the civil date object shape seen in the raw records.
    const startDate = { year: Number(rollFrom.slice(0,4)), month: Number(rollFrom.slice(5,7)), day: Number(rollFrom.slice(8,10)) };
    const endDate   = { year: Number(rollToExcl.slice(0,4)), month: Number(rollToExcl.slice(5,7)), day: Number(rollToExcl.slice(8,10)) };

    interface RollupAttempt {
      label:   string;
      action:  string;
      method:  "GET" | "POST";
      qs?:     string;   // query string to append to URL
      body?:   string;   // JSON body for POST (omit → no body)
    }

    // "rollUp (empty body)" → "Invalid time range" (semantic, not parse) proves the POST
    // body can be empty — time range must come via query params. Every body field name
    // failed with "Cannot find field", so the range is in the URL, not the body.
    const isoFrom   = `${rollFrom}T00:00:00Z`;
    const isoToExcl = `${rollToExcl}T00:00:00Z`;

    const qs = {
      startEndTime:  `startTime=${encodeURIComponent(isoFrom)}&endTime=${encodeURIComponent(isoToExcl)}`,
      startEndSnake: `start_time=${encodeURIComponent(isoFrom)}&end_time=${encodeURIComponent(isoToExcl)}`,
      startEndDate:  `startDate=${rollFrom}&endDate=${rollToExcl}`,
      startEndDateSnake: `start_date=${rollFrom}&end_date=${rollToExcl}`,
    };

    const attempts: RollupAttempt[] = [
      // GET — no body, time range via query param
      { label: "GET rollUp ?startTime/endTime",       action: "rollUp",      method: "GET", qs: qs.startEndTime  },
      { label: "GET rollUp ?start_time/end_time",     action: "rollUp",      method: "GET", qs: qs.startEndSnake },
      { label: "GET rollUp ?startDate/endDate",        action: "rollUp",      method: "GET", qs: qs.startEndDate  },
      { label: "GET rollUp ?start_date/end_date",     action: "rollUp",      method: "GET", qs: qs.startEndDateSnake },
      { label: "GET dailyRollUp ?startTime/endTime",  action: "dailyRollUp", method: "GET", qs: qs.startEndTime  },
      { label: "GET dailyRollUp ?start_time/end_time",action: "dailyRollUp", method: "GET", qs: qs.startEndSnake },
      { label: "GET dailyRollUp ?startDate/endDate",  action: "dailyRollUp", method: "GET", qs: qs.startEndDate  },
      // POST with query params + empty JSON body
      { label: "POST rollUp ?startTime/endTime",      action: "rollUp",      method: "POST", qs: qs.startEndTime,  body: "{}" },
      { label: "POST rollUp ?start_time/end_time",    action: "rollUp",      method: "POST", qs: qs.startEndSnake, body: "{}" },
      { label: "POST rollUp ?startDate/endDate",      action: "rollUp",      method: "POST", qs: qs.startEndDate,  body: "{}" },
      { label: "POST dailyRollUp ?startTime/endTime", action: "dailyRollUp", method: "POST", qs: qs.startEndTime,  body: "{}" },
      { label: "POST dailyRollUp ?startDate/endDate", action: "dailyRollUp", method: "POST", qs: qs.startEndDate,  body: "{}" },
    ];

    let successBody: unknown = null;
    let successLabel = "";

    for (const att of attempts) {
      const url = `${BASE}/${rt.id}/dataPoints:${att.action}${att.qs ? `?${att.qs}` : ""}`;
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      if (att.body !== undefined) headers["Content-Type"] = "application/json";

      let resp: Response;
      try {
        resp = await fetch(url, { method: att.method, headers, body: att.body });
      } catch (e) {
        console.log(`  ${att.label} → NETWORK ERROR: ${e}`);
        continue;
      }

      let body: unknown = null;
      try { body = await resp.json(); } catch { /* non-JSON */ }

      if (resp.ok) {
        const pts = (
          body !== null && typeof body === "object" && !Array.isArray(body) && "dataPoints" in body &&
          Array.isArray((body as Record<string, unknown>)["dataPoints"])
        ) ? (body as { dataPoints: unknown[] }).dataPoints : [];
        const hasNext = body !== null && typeof body === "object" && !Array.isArray(body) && "nextPageToken" in body;
        console.log(`  ${att.label} → 200 OK  pts=${pts.length}  hasNextPage=${hasNext ? "yes" : "no"}`);
        if (!successBody && pts.length > 0) { successBody = body; successLabel = att.label; }
        break;
      } else {
        let errStatus = "";
        let errMsg    = "";
        if (body !== null && typeof body === "object" && !Array.isArray(body) && "error" in body) {
          const err = (body as Record<string, unknown>)["error"];
          if (err !== null && typeof err === "object" && !Array.isArray(err)) {
            const e = err as Record<string, unknown>;
            errStatus = typeof e["status"]  === "string" ? e["status"]  : "";
            errMsg    = typeof e["message"] === "string" ? e["message"] : "";
          }
        }
        console.log(`  ${att.label} → ${resp.status} ${errStatus || "ERROR"}  ${errMsg.slice(0, 100)}`);
      }
    }

    // Field shape + daily-ness analysis
    if (
      successBody !== null && typeof successBody === "object" && !Array.isArray(successBody) &&
      "dataPoints" in successBody
    ) {
      const pts = (successBody as { dataPoints: unknown[] }).dataPoints;
      console.log(`\n  Total records returned: ${pts.length}`);
      console.log(`  (${successLabel})`);

      if (pts.length > 0) {
        console.log("\n  FIRST RECORD (raw):");
        console.log(JSON.stringify(pts[0], null, 4).split("\n").map((l) => "  " + l).join("\n"));

        // Collect unique civil dates to check one-per-day
        const dates = new Set<string>();
        for (const pt of pts) {
          if (pt === null || typeof pt !== "object" || Array.isArray(pt)) continue;
          const rec = pt as Record<string, unknown>;
          // Look for civilStartTime.date in any top-level payload key
          for (const val of Object.values(rec)) {
            if (val === null || typeof val !== "object" || Array.isArray(val)) continue;
            const v = val as Record<string, unknown>;
            const interval = v["interval"];
            const cst = v["civilStartTime"] ??
              (interval !== null && typeof interval === "object" && !Array.isArray(interval)
                ? (interval as Record<string, unknown>)["civilStartTime"]
                : undefined);
            if (cst !== null && typeof cst === "object" && !Array.isArray(cst)) {
              const d = (cst as Record<string, unknown>)["date"];
              if (d !== null && typeof d === "object" && !Array.isArray(d)) {
                const dd = d as Record<string, number>;
                if (dd["year"] && dd["month"] && dd["day"]) {
                  dates.add(`${dd["year"]}-${String(dd["month"]).padStart(2,"0")}-${String(dd["day"]).padStart(2,"0")}`);
                }
              }
            }
          }
        }
        console.log(`\n  Unique civil dates in result: ${dates.size} / ${pts.length} records`);
        if (dates.size > 0) console.log(`  Dates: ${[...dates].sort().join(", ")}`);

        const verdict = dates.size === pts.length && dates.size > 1
          ? "DAILY-AGGREGATED (1 record/day, cheap)"
          : pts.length > dates.size
          ? `INTRADAY-ONLY (${pts.length} records across ${dates.size} day(s) — must aggregate client-side)`
          : "UNKNOWN (only 1 date in window — inconclusive)";
        console.log(`\n  VERDICT: ${verdict}`);
      }
    } else {
      console.log("\n  VERDICT: INTRADAY-ONLY (no dailyRollUp/rollUp returned data)");
    }
  }

  console.log();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
