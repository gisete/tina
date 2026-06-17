import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readHrSummaries } from "@/lib/sync/read";
import { calculateHrTrends, WINDOW_DAYS, type HrWindow } from "@/lib/analytics/hr-trends";
import { localToday, addDays } from "@/lib/dates";

async function main() {
  const today = localToday();
  const maxDays = Math.max(...(Object.values(WINDOW_DAYS) as number[]));
  const startDate = addDays(today, -(2 * maxDays - 1));

  const userRow = await db.query.users.findFirst({ where: eq(users.email, "gisete@gmail.com") });
  if (!userRow) { console.error("user not found"); process.exit(1); }

  const summaries = await readHrSummaries(userRow.id, startDate, today);
  console.log(`Fetched ${summaries.length} rows  (${startDate} → ${today})`);

  const windows: HrWindow[] = ["week", "month", "90d"];
  for (const w of windows) {
    const r = calculateHrTrends(summaries, w, today);
    const s = r.stats;
    console.log(`\n${w}: points=${r.points.length}  nightsWithData=${s.nightsWithData}`);
    console.log(`  windowAvgRhr=${s.windowAvgRhr} bpm  [${s.minRhr}–${s.maxRhr}]`);
    console.log(`  prevWindowAvgRhr=${s.prevWindowAvgRhr}  rhrDeltaVsPrev=${s.rhrDeltaVsPrev}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
