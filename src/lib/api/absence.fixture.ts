// npx tsx src/lib/api/absence.fixture.ts
import { classifyAbsence, dayMetric } from "./absence";
import { derived, estimated, measured, unavailable } from "./metric";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const ctx = { syncedThrough: "2026-10-20", today: "2026-10-22" };

// On or before the cursor, no data → not_worn.
assert(classifyAbsence("2026-10-20", ctx) === "not_worn", "cursor day itself is not_worn");
assert(classifyAbsence("2026-05-01", ctx) === "not_worn", "old covered day is not_worn");
// After the cursor → not_synced (including today and the day after the cursor).
assert(classifyAbsence("2026-10-21", ctx) === "not_synced", "day after cursor is not_synced");
assert(classifyAbsence("2026-10-22", ctx) === "not_synced", "today past the cursor is not_synced");
// No cursor at all → nothing is known to be covered.
assert(classifyAbsence("2026-01-01", { syncedThrough: null, today: "2026-10-22" }) === "not_synced", "null cursor → not_synced");
// Cursor reaching today: an empty today is not_worn.
assert(classifyAbsence("2026-10-22", { syncedThrough: "2026-10-22", today: "2026-10-22" }) === "not_worn", "cursor at today");

// dayMetric: absence is never 0.
assert(eq(dayMetric(null, "min", "2026-10-10", ctx), unavailable("not_worn")), "null covered → not_worn");
assert(eq(dayMetric(undefined, "min", "2026-10-21", ctx), unavailable("not_synced")), "undefined uncovered → not_synced");
// A real zero stays a measured zero.
assert(eq(dayMetric(0, "min", "2026-10-10", ctx), { status: "measured", value: 0, unit: "min" }), "0 stays measured 0");
// Today's accumulating values are measured but flagged partial_day; past days are not.
assert(eq(dayMetric(4200, "steps", "2026-10-22", ctx, { accumulatesDuringDay: true }),
  { status: "measured", value: 4200, unit: "steps", flags: ["partial_day"] }), "today partial flag");
assert(eq(dayMetric(9000, "steps", "2026-10-19", ctx, { accumulatesDuringDay: true }),
  { status: "measured", value: 9000, unit: "steps" }), "past day not flagged");
assert(eq(dayMetric(55, "bpm", "2026-10-22", ctx), { status: "measured", value: 55, unit: "bpm" }), "non-accumulating today not flagged");

// Builders produce the exact union shapes.
assert(eq(estimated(3, "events", "HR-derived"), { status: "estimated", value: 3, unit: "events", method: "HR-derived" }), "estimated shape");
assert(eq(derived(82, "score"), { status: "derived", value: 82, unit: "score" }), "derived shape");
assert(eq(measured(1, "x", []), { status: "measured", value: 1, unit: "x" }), "empty flags omitted");

console.log("absence fixture: all assertions passed");
