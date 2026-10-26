/**
 * Backfill start/end UTC offsets on sleep_sessions for 2026-09-20..2026-10-06.
 * Fetches ONLY sleep (no zones, steps, heart rate), in windows of <= 7 days,
 * matches rows on (user_id, start_time) and sets ONLY the two offset columns
 * where they are currently null.
 *
 * Dry run (default): prints one row per session. --apply performs the update.
 * Run: env $(grep -v '^#' .env.local | grep -v '^[[:space:]]*$' | xargs) \
 *        npx tsx scripts/backfill-sleep-offsets.ts [--apply]
 */
import { db } from "@/db/client";
import { users, sleepSessions } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { fetchGoogleSleepData } from "@/lib/google/client";
import { parseUtcOffsetSeconds } from "@/lib/google/normalizers";
import { addDays, parseLocalDate } from "@/lib/dates";

const USER_EMAIL = "gisete@gmail.com";
const FROM = "2026-09-20";
const TO = "2026-10-06";
const WINDOW_DAYS = 7;

const localMidnightISO = (date: string): string => parseLocalDate(date).toISOString();

/** Wall-clock "YYYY-MM-DD HH:mm" of an instant shifted by a fixed offset. */
const shifted = (ms: number, offsetSeconds: number): string =>
  new Date(ms + offsetSeconds * 1000).toISOString().slice(0, 16).replace("T", " ");

const lisbon = (ms: number): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon", dateStyle: "short", timeStyle: "short" }).format(ms);

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const user = await db.query.users.findFirst({ where: eq(users.email, USER_EMAIL) });
  if (!user) throw new Error(`User not found: ${USER_EMAIL}`);

  const found = new Map<number, { start: number; startOff: number | null; endOff: number | null }>();
  for (let start = FROM; start <= TO; start = addDays(start, WINDOW_DAYS)) {
    const last = addDays(start, WINDOW_DAYS - 1);
    const end = last < TO ? last : TO;
    const blocks = await fetchGoogleSleepData(user.id, localMidnightISO(start), localMidnightISO(addDays(end, 1)));
    for (const b of blocks) {
      const i = b.sleep?.interval;
      if (!i) continue;
      const ms = new Date(i.startTime).getTime();
      found.set(ms, {
        start: ms,
        startOff: parseUtcOffsetSeconds(i.startUtcOffset),
        endOff: parseUtcOffsetSeconds(i.endUtcOffset),
      });
    }
  }

  const rows = await db.select().from(sleepSessions).where(eq(sleepSessions.userId, user.id));
  const byStart = new Map(rows.map((r) => [r.startTime.getTime(), r]));

  console.log(`mode: ${apply ? "APPLY" : "DRY RUN"}   sessions from Google: ${found.size}`);
  console.log("sleepDate   | stored UTC start     | startOff | endOff | offset-local start | Lisbon start     | state");
  const matched: { id: string; startOff: number | null; endOff: number | null }[] = [];
  for (const f of [...found.values()].sort((a, b) => a.start - b.start)) {
    const row = byStart.get(f.start);
    const utc = new Date(f.start).toISOString().slice(0, 16).replace("T", " ");
    const local = f.startOff === null ? "(none)" : shifted(f.start, f.startOff);
    let state: string;
    if (!row) state = "NO DB ROW";
    else if (row.startUtcOffsetSeconds !== null || row.endUtcOffsetSeconds !== null) state = "already set";
    else state = "will update";
    console.log(`${row?.sleepDate ?? "—         "} | ${utc}     | ${String(f.startOff).padStart(8)} | ${String(f.endOff).padStart(6)} | ${local}   | ${lisbon(f.start)} | ${state}`);
    if (row) matched.push({ id: row.id, startOff: f.startOff, endOff: f.endOff });
  }

  const ids = matched.map((m) => m.id);
  const hash = async (): Promise<string> => {
    if (ids.length === 0) return "empty";
    const r = await db.execute(sql`select md5(string_agg((to_jsonb(s) - 'start_utc_offset_seconds' - 'end_utc_offset_seconds')::text, '|' order by id)) as h from sleep_sessions s where id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    return String((r.rows[0] as { h: string }).h);
  };
  console.log(`matched DB rows: ${matched.length}; unmatched Google sessions: ${found.size - matched.length}`);
  if (!apply) return;

  const before = await hash();
  let updated = 0;
  for (const m of matched) {
    const res = await db
      .update(sleepSessions)
      .set({ startUtcOffsetSeconds: m.startOff, endUtcOffsetSeconds: m.endOff })
      .where(and(eq(sleepSessions.id, m.id), isNull(sleepSessions.startUtcOffsetSeconds), isNull(sleepSessions.endUtcOffsetSeconds)))
      .returning({ id: sleepSessions.id });
    updated += res.length;
  }
  const after = await hash();
  console.log(`rows updated: ${updated} / sessions in range: ${matched.length}`);
  console.log(`hash of other columns before: ${before}\nhash of other columns after : ${after}  → ${before === after ? "UNCHANGED" : "CHANGED!"}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
