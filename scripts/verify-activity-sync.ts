import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/db/client";
import { users, dailyActivitySummaries } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { calculateActiveZoneMinutes } from "@/lib/analytics/activity";

async function main() {
  const user = await db.query.users.findFirst({ where: eq(users.email, "gisete@gmail.com") });
  if (!user) { console.error("user not found"); process.exit(1); }

  const rows = await db.query.dailyActivitySummaries.findMany({
    where: eq(dailyActivitySummaries.userId, user.id),
    orderBy: [desc(dailyActivitySummaries.activityDate)],
    limit: 10,
  });

  if (rows.length === 0) { console.log("No rows yet — run a sync first"); process.exit(0); }

  console.log("\ndaily_activity_summaries (most recent 10 rows):");
  console.log("date         light  mod  vig  peak  AZM");
  console.log("─".repeat(50));
  for (const r of rows) {
    const azm = calculateActiveZoneMinutes({
      light: r.lightMinutes,
      moderate: r.moderateMinutes,
      vigorous: r.vigorousMinutes,
      peak: r.peakMinutes,
    });
    console.log(
      `${r.activityDate}   ${String(r.lightMinutes).padStart(4)}  ${String(r.moderateMinutes).padStart(4)}  ${String(r.vigorousMinutes).padStart(3)}  ${String(r.peakMinutes).padStart(4)}  ${azm}`
    );
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
