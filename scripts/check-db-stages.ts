import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/db/client";
import { sleepSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

async function run() {
  const sessions = await db.query.sleepSessions.findMany({
    where: eq(sleepSessions.sleepDate, "2026-06-11"),
    with: { stages: true },
  });
  console.log("DB sessions for sleep_date=2026-06-11:", sessions.length);
  for (const s of sessions) {
    const awake = s.stages.filter((st) => st.stageType === "awake");
    console.log("  stages total:", s.stages.length);
    console.log("  AWAKE blocks:", awake.length);
    for (const a of awake.sort((x, y) => x.startTime.getTime() - y.startTime.getTime())) {
      const durMin = Math.round(a.durationMs / 60_000 * 10) / 10;
      console.log(`    ${a.startTime.toISOString()} -> ${a.endTime.toISOString()} (${durMin}m)`);
    }
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
