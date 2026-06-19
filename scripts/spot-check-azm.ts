import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/db/client";
import { dailyActivitySummaries, users } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { calculateActiveZoneMinutes } from "@/lib/analytics/activity";

const CHECK_DATES = ["2026-06-18", "2026-06-16", "2026-06-14", "2026-05-31", "2026-03-23", "2026-06-17"];

async function main() {
  const user = await db.query.users.findFirst({ where: eq(users.email, "gisete@gmail.com") });
  if (!user) { console.error("User not found"); process.exit(1); }

  const rows = await db.query.dailyActivitySummaries.findMany({
    where: and(
      eq(dailyActivitySummaries.userId, user.id),
      inArray(dailyActivitySummaries.activityDate, CHECK_DATES),
    ),
  });

  const sorted = rows.sort((a, b) => a.activityDate.localeCompare(b.activityDate));
  console.log("\nDate          L       M    V    P    AZM(live)");
  for (const r of sorted) {
    const azm = calculateActiveZoneMinutes({
      light: r.lightMinutes, moderate: r.moderateMinutes,
      vigorous: r.vigorousMinutes, peak: r.peakMinutes,
    });
    console.log(`${r.activityDate}  L=${String(r.lightMinutes).padEnd(4)}  M=${String(r.moderateMinutes).padEnd(3)}  V=${String(r.vigorousMinutes).padEnd(3)}  P=${String(r.peakMinutes).padEnd(3)}  AZM=${azm}`);
  }

  const weekRows = sorted.filter(r => r.activityDate >= "2026-06-16" && r.activityDate <= "2026-06-18");
  const weekTotal = weekRows.reduce((s, r) => s + calculateActiveZoneMinutes({
    light: r.lightMinutes, moderate: r.moderateMinutes,
    vigorous: r.vigorousMinutes, peak: r.peakMinutes,
  }), 0);
  console.log(`\nWeek-to-date (Mon Jun 16 – Wed Jun 18): ${weekTotal} AZM`);
  console.log("Expected: 1 (Jun16) + 0 (Jun17) + 3 (Jun18) = 4");
}

main().catch(e => { console.error(e); process.exit(1); });
