// npx tsx src/lib/api/params.fixture.ts
import { enumerateDates, isCivilDate, parseDayParams, parseRangeParams } from "./params";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

assert(isCivilDate("2026-02-28") && isCivilDate("2028-02-29"), "valid dates");
assert(!isCivilDate("2026-02-30") && !isCivilDate("2026-13-01") && !isCivilDate("26-01-01") && !isCivilDate("2026-1-1"), "invalid dates");

const d0 = parseDayParams({ date: null }, "2026-10-28");
assert(d0.ok && d0.value.date === "2026-10-28", "default today");
const d1 = parseDayParams({ date: "2026-10-01" }, "2026-10-28");
assert(d1.ok && d1.value.date === "2026-10-01", "explicit date");
const d2 = parseDayParams({ date: "yesterday" }, "2026-10-28");
assert(!d2.ok && d2.code === "invalid_parameter", "bad date");

const ok92 = parseRangeParams({ from: "2026-07-01", to: "2026-09-30" }); // 92 days
assert(ok92.ok, "92 days allowed");
const over = parseRangeParams({ from: "2026-07-01", to: "2026-10-01" }); // 93 days
assert(!over.ok && over.code === "range_too_large", "93 days → range_too_large");
const rev = parseRangeParams({ from: "2026-10-02", to: "2026-10-01" });
assert(!rev.ok && rev.code === "invalid_parameter", "from after to");
assert(!parseRangeParams({ from: "2026-10-02", to: null }).ok, "missing to");
const one = parseRangeParams({ from: "2026-10-01", to: "2026-10-01" });
assert(one.ok, "single-day range");

assert(enumerateDates("2026-10-30", "2026-11-02").join() === "2026-10-30,2026-10-31,2026-11-01,2026-11-02", "enumerate across month end");
console.log("params fixture: all assertions passed");
