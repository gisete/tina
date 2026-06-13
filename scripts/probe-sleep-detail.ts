/**
 * Throwaway probe: investigates whether Google Health API v4 exposes
 * sub-minute restlessness events that are NOT present in the plain dataPoints
 * list for the `sleep` data type.
 *
 * Variants probed:
 *   A) Individual data point GET  (dataPoints/<id>)
 *   B) dataPoints:reconcile       (deduplication list variant)
 *   C) dataPoints:rollUp          (aggregation — may be unsupported for sleep)
 *   D) dataPoints:dailyRollUp     (daily summary — may be unsupported for sleep)
 *
 * Each raw response is written to scripts/output/<variant>.json.
 * Final console summary lists any extra top-level keys, any stage blocks shorter
 * than 2 minutes, and any field whose name contains "restless", "short", "arousal",
 * "movement", "stir", or "brief".
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGoogleValidClientToken } from "@/lib/google/client";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const USER_EMAIL = "gisete@gmail.com";

// The data point ID reported by the dashboard for 2026-06-11 night
const KNOWN_DATA_POINT_ID = "3708017314633870712";

// Night of 2026-06-11 → 2026-06-12 morning: generous window covering the full session
const SESSION_START = "2026-06-11T00:00:00Z";
const SESSION_END   = "2026-06-12T23:59:59Z";

const OUTPUT_DIR = join(__dirname, "output");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function saveJson(name: string, data: unknown) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const path = join(OUTPUT_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`  ✓ Saved → scripts/output/${name}.json`);
}

async function apiFetch(token: string, url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  let body: unknown;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status, body };
}

function findInterestingFields(obj: unknown, path = ""): string[] {
  const hits: string[] = [];
  const INTERESTING = /restless|short|arousal|movement|stir|brief|brief_wake|sub_?minute|event|micro/i;

  if (obj === null || typeof obj !== "object") return hits;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = path ? `${path}.${k}` : k;
    if (INTERESTING.test(k)) hits.push(`${fullPath} = ${JSON.stringify(v)}`);
    hits.push(...findInterestingFields(v, fullPath));
  }
  return hits;
}

function findShortStages(obj: unknown, thresholdMs = 2 * 60 * 1000): Array<{ path: string; block: unknown }> {
  const hits: Array<{ path: string; block: unknown }> = [];
  function walk(o: unknown, path: string) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) {
      o.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    const obj = o as Record<string, unknown>;
    // A stage block has a type plus start/end times
    if (obj.type && obj.startTime && obj.endTime) {
      const dur = new Date(obj.endTime as string).getTime() - new Date(obj.startTime as string).getTime();
      if (dur < thresholdMs && dur >= 0) {
        hits.push({ path, block: { ...obj, durMs: dur, durSec: Math.round(dur / 1000) } });
      }
    }
    for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
  }
  walk(obj, "root");
  return hits;
}

function topLevelKeys(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.keys(body as object);
}

function countStages(body: unknown): number {
  let n = 0;
  function walk(o: unknown) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const obj = o as Record<string, unknown>;
    if (obj.type && obj.startTime && obj.endTime) n++;
    for (const v of Object.values(obj)) walk(v);
  }
  walk(body);
  return n;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Look up userId
  console.log(`\nLooking up user: ${USER_EMAIL}`);
  const user = await db.query.users.findFirst({ where: eq(users.email, USER_EMAIL) });
  if (!user) throw new Error(`User not found: ${USER_EMAIL}`);
  console.log(`  userId: ${user.id}`);

  const token = await getGoogleValidClientToken(user.id);
  console.log("  Token obtained.\n");

  const BASE = "https://health.googleapis.com/v4/users/me/dataTypes/sleep";

  const variants: Array<{ name: string; url: string; description: string }> = [
    {
      name: "A_individual_get",
      url: `${BASE}/dataPoints/${KNOWN_DATA_POINT_ID}`,
      description: "Individual data point GET (rest.get method)",
    },
    {
      name: "B_reconcile_list",
      url: `${BASE}/dataPoints:reconcile?filter=${encodeURIComponent(
        `sleep.interval.end_time >= "${SESSION_START}" AND sleep.interval.end_time < "${SESSION_END}"`
      )}&pageSize=5`,
      description: "dataPoints:reconcile (deduplication list variant)",
    },
    {
      name: "C_rollUp",
      url: `${BASE}/dataPoints:rollUp?filter=${encodeURIComponent(
        `sleep.interval.end_time >= "${SESSION_START}" AND sleep.interval.end_time < "${SESSION_END}"`
      )}`,
      description: "dataPoints:rollUp (aggregation variant)",
    },
    {
      name: "D_dailyRollUp",
      url: `${BASE}/dataPoints:dailyRollUp?filter=${encodeURIComponent(
        `sleep.interval.end_time >= "${SESSION_START}" AND sleep.interval.end_time < "${SESSION_END}"`
      )}`,
      description: "dataPoints:dailyRollUp (daily summary variant)",
    },
  ];

  const results: Array<{
    name: string;
    status: number;
    keys: string[];
    stageCount: number;
    shortStages: Array<{ path: string; block: unknown }>;
    interestingFields: string[];
  }> = [];

  for (const v of variants) {
    console.log(`── ${v.name}: ${v.description}`);
    console.log(`   GET ${v.url.split("?")[0]}`);

    const { status, body } = await apiFetch(token, v.url);
    console.log(`   HTTP ${status}`);

    saveJson(v.name, { _meta: { status, url: v.url }, body });

    const shortStages = findShortStages(body);
    const interestingFields = findInterestingFields(body);
    const keys = topLevelKeys(body);
    const stageCount = countStages(body);

    results.push({ name: v.name, status, keys, stageCount, shortStages, interestingFields });

    if (shortStages.length) {
      console.log(`   ⚠ ${shortStages.length} stage block(s) shorter than 2m!`);
    }
    if (interestingFields.length) {
      console.log(`   ★ Interesting fields found: ${interestingFields.length}`);
    }
    console.log();
  }

  // ---------------------------------------------------------------------------
  // Summary report
  // ---------------------------------------------------------------------------
  console.log("=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));

  for (const r of results) {
    console.log(`\n${r.name}  (HTTP ${r.status})`);
    console.log(`  Top-level keys: ${r.keys.join(", ") || "(none / error)"}`);
    console.log(`  Stage blocks counted: ${r.stageCount}`);

    if (r.shortStages.length === 0) {
      console.log("  Short stages (<2m): none");
    } else {
      console.log(`  Short stages (<2m): ${r.shortStages.length}`);
      for (const s of r.shortStages) {
        const b = s.block as Record<string, unknown>;
        console.log(`    • [${b.type}] ${b.startTime} – ${b.endTime}  (${b.durSec}s)`);
      }
    }

    if (r.interestingFields.length === 0) {
      console.log("  Interesting fields: none");
    } else {
      console.log(`  Interesting fields:`);
      for (const f of r.interestingFields) {
        console.log(`    • ${f}`);
      }
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("Raw files written to scripts/output/  — diff them for full detail.");
  console.log("=".repeat(72) + "\n");

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
