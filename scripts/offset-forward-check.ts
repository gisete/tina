// Forces one recent-window sync step, then prints stored UTC offsets for the last 3 days.
//   npx tsx scripts/offset-forward-check.ts
import { config } from "dotenv"; config({ path: ".env.local" });
import { db } from "@/db/client";
import { users, sleepSessions } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { runSyncStep } from "@/lib/sync/step";

async function main(): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.email, "gisete@gmail.com") });
  if (!user) throw new Error("user not found");
  const col = await db.execute(sql`select column_name, data_type, is_nullable from information_schema.columns where table_name='sleep_sessions' and column_name like '%utc_offset%'`);
  console.log("columns:", JSON.stringify(col.rows));
  const res = await runSyncStep(user.id, { force: true });
  console.log("step:", JSON.stringify(res));
  const rows = await db.select().from(sleepSessions).where(eq(sleepSessions.userId, user.id)).orderBy(desc(sleepSessions.startTime)).limit(5);
  for (const r of rows) console.log(r.sleepDate, r.startTime.toISOString(), r.endTime.toISOString(), "start", r.startUtcOffsetSeconds, "end", r.endUtcOffsetSeconds);
  const nn = await db.execute(sql`select count(*) filter (where start_utc_offset_seconds is not null) as with_offset, count(*) as total from sleep_sessions`);
  console.log("counts:", JSON.stringify(nn.rows));
  process.exit(0);
}
main();
