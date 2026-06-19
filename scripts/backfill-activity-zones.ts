/**
 * Backfill daily_activity_summaries for N civil days.
 *
 * Run: env $(cat .env.local | grep -v '^#' | grep -v '^[[:space:]]*$' | xargs) \
 *        npx tsx scripts/backfill-activity-zones.ts [days]
 *
 * Default N=90. Idempotent — safe to re-run.
 * Days with no records (device off / beyond retention) are skipped, not stored.
 */
import { config } from "dotenv"; config({ path: ".env.local" });

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchGoogleZoneRecords } from "@/lib/google/client";
import { normalizeZoneRecords } from "@/lib/google/normalizers";
import { aggregateZoneMinutes, calculateActiveZoneMinutes } from "@/lib/analytics/activity";
import { persistActivitySummaries } from "@/lib/sync/persist";
import { localToday, addDays } from "@/lib/dates";

const USER_EMAIL = "gisete@gmail.com";
const DEFAULT_DAYS = 90;
const PACE_MS = 200; // delay between day fetches

async function main(): Promise<void> {
  const rawArg = process.argv[2];
  const days = rawArg ? Math.max(1, Math.min(365, parseInt(rawArg, 10))) : DEFAULT_DAYS;

  const user = await db.query.users.findFirst({ where: eq(users.email, USER_EMAIL) });
  if (!user) { console.error(`User not found: ${USER_EMAIL}`); process.exit(1); }

  const today = localToday();
  console.log(`\nBackfill activity zones — ${days} civil days ending ${today}\n`);

  let upserted = 0;
  let gaps = 0;
  let errors = 0;

  for (let i = 0; i < days; i++) {
    const targetDate = addDays(today, -i);

    // 48-hour UTC window centered on the civil day. addDays returns "YYYY-MM-DD";
    // appending a literal UTC time is safe — no new Date("YYYY-MM-DD") constructor used.
    const windowStart = addDays(targetDate, -1) + "T12:00:00Z";
    const windowEnd   = addDays(targetDate,  1) + "T12:00:00Z";

    try {
      const raw       = await fetchGoogleZoneRecords(user.id, windowStart, windowEnd);
      const allRecords = normalizeZoneRecords(raw);

      // Filter to records whose civil date (from the API's civilStartTime.date)
      // matches the target day — correct regardless of timezone.
      const dayRecords = allRecords.filter((r) => r.civilDate === targetDate);

      if (dayRecords.length === 0) {
        // No records → device not worn or data beyond retention. Leave absent.
        process.stdout.write(`  ${targetDate}  GAP\n`);
        gaps++;
      } else {
        const zones = aggregateZoneMinutes(dayRecords);
        const azm   = calculateActiveZoneMinutes(zones);
        await persistActivitySummaries(user.id, [{
          activityDate:    targetDate,
          lightMinutes:    zones.light,
          moderateMinutes: zones.moderate,
          vigorousMinutes: zones.vigorous,
          peakMinutes:     zones.peak,
        }]);
        process.stdout.write(
          `  ${targetDate}  recs=${dayRecords.length}  L=${zones.light}  M=${zones.moderate}  V=${zones.vigorous}  P=${zones.peak}  AZM=${azm}\n`,
        );
        upserted++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(`  ${targetDate}  ERROR: ${msg}\n`);
      errors++;
    }

    if (i < days - 1) {
      await new Promise<void>((r) => setTimeout(r, PACE_MS));
    }
  }

  console.log(`\nDone — ${upserted} upserted, ${gaps} gaps, ${errors} errors`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
