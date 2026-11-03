// npx tsx src/lib/api/windows.fixture.ts
import { addDays } from "@/lib/dates";
import { rowsBeforeDay } from "./windows";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

interface Row { sleepDate: string; id: number }
// 200 days, a heavy 5 rows per date in the last 120 days (naps, splits), 1 before.
const all: Row[] = [];
let id = 0;
for (let i = 0; i < 200; i++) {
  const d = addDays("2026-04-01", i);
  const n = i >= 80 ? 5 : 1;
  for (let k = 0; k < n; k++) all.push({ sleepDate: d, id: id++ });
}
const newestFirst = (rows: Row[]) => [...rows].sort((a, b) => (b.sleepDate === a.sleepDate ? b.id - a.id : b.sleepDate.localeCompare(a.sleepDate)));
const db = newestFirst(all);
// What the dashboard query does for day D: lt(sleepDate, D), newest first, limit 90.
const direct = (d: string) => db.filter((r) => r.sleepDate < d).slice(0, 90);

const from = "2026-10-01";
const to = "2026-12-31"; // 92-day range
const beforeRange = db.filter((r) => r.sleepDate < from).slice(0, 90);
const inRange = db.filter((r) => r.sleepDate >= from && r.sleepDate < to);
let checked = 0;
for (let d = from; d <= to; d = addDays(d, 1)) {
  const got = rowsBeforeDay(beforeRange, inRange, d, 90).map((r) => r.id).join();
  const want = direct(d).map((r) => r.id).join();
  assert(got === want, `window for ${d} equals the single-day query`);
  checked++;
}
assert(checked === 92, "checked every day of the range");
console.log("windows fixture: all assertions passed");
