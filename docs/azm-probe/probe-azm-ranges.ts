// One-off, read-only probe #2 (Task 12 on hold): active-zone-minutes dailyRollUp over given ranges.
// Run: npx tsx docs/azm-probe/probe-azm-ranges.ts 2026-10-19:2026-10-26 2026-09-30:2026-09-30 ...
// Each arg is FIRST:LAST (inclusive civil dates). Writes raw responses next to this file.
// Never prints or stores the access token.
import "../../scripts/_load-env";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGoogleValidClientToken } from "@/lib/google/client";
import { addDays } from "@/lib/dates";

const URL_ = "https://health.googleapis.com/v4/users/me/dataTypes/active-zone-minutes/dataPoints:dailyRollUp";
const civil = (s: string) => { const [year, month, day] = s.split("-").map(Number); return { date: { year, month, day } }; };

async function main(): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.email, "gisete@gmail.com") });
  if (!user) throw new Error("user not found");
  const token = await getGoogleValidClientToken(user.id);
  for (const arg of process.argv.slice(2)) {
    const [first, last] = arg.split(":");
    const body = { range: { start: civil(first), end: civil(addDays(last, 1)) } };
    const res = await fetch(URL_, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep raw text */ }
    const name = first === last ? first : `${first}_to_${last}`;
    writeFileSync(join(__dirname, `azm-dailyrollup-${name}.json`), JSON.stringify({ request: body, httpStatus: res.status, response: parsed }, null, 2) + "\n");
    console.log(`${name}: HTTP ${res.status}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
