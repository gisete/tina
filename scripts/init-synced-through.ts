/**
 * One-off: initialise sync_state.synced_through from the data actually stored
 * (NOT from last_synced_at, which a recent 3-day sync bumps without covering
 * older gaps). A day counts as covered when it has a sleep session (by
 * sleep_date), a heart summary, or an activity row with non-zero zone minutes
 * (steps-only default-0 rows don't count).
 *
 * Run: env $(cat .env.local | grep -v '^#' | grep -v '^[[:space:]]*$' | xargs) \
 *        npx tsx scripts/init-synced-through.ts [--write]
 * Without --write it only reports. It never overwrites a non-null value.
 */
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { localToday } from "@/lib/dates";
import { deriveSyncedThrough } from "@/lib/sync/catch-up";

/** SPEC STOP rule: a derived value later than this means the walk is wrong. */
const STOP_IF_AFTER = "2026-10-13";

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const today = localToday();

  const rows = await db.execute(sql`
    select user_id::text as user_id, d::text as d from (
      select user_id, sleep_date as d from sleep_sessions
      union select user_id, date as d from heart_rate_summaries
      union select user_id, activity_date as d from daily_activity_summaries
        where light_minutes + moderate_minutes + vigorous_minutes + peak_minutes > 0
    ) c
  `);
  const state = await db.execute(sql`select user_id::text as user_id, synced_through::text as synced_through, last_synced_at::text as last_synced_at from sync_state`);

  for (const s of state.rows as Array<{ user_id: string; synced_through: string | null; last_synced_at: string }>) {
    const covered = (rows.rows as Array<{ user_id: string; d: string }>)
      .filter((r) => r.user_id === s.user_id)
      .map((r) => r.d);
    const derived = deriveSyncedThrough(covered, today);
    console.log(`user ${s.user_id}: today=${today} covered_days=${covered.length} last_synced_at=${s.last_synced_at} current_synced_through=${s.synced_through} derived=${derived}`);

    if (derived === null || derived > STOP_IF_AFTER) {
      console.error(`STOP: derived ${derived} is later than ${STOP_IF_AFTER} (or null). Not writing.`);
      process.exit(2);
    }
    if (s.synced_through !== null) { console.log("synced_through already set; leaving it."); continue; }
    if (!write) { console.log("dry run (no --write): nothing written."); continue; }
    await db.execute(sql`update sync_state set synced_through = ${derived} where user_id = ${s.user_id}::uuid and synced_through is null`);
    console.log(`wrote synced_through=${derived}`);
  }
  process.exit(0);
}
main();
