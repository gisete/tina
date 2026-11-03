// npx tsx src/lib/api/validate.fixture.ts
import { SCHEMA_DOC } from "./schema-doc";
import { validateAgainstDoc, validateEnvelope, validateMetricShapes, type Json } from "./validate";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
const has = (errs: string[], needle: string) => errs.some((e) => e.includes(needle));

// Metric shapes.
assert(validateMetricShapes({ a: { status: "measured", value: 1, unit: "bpm" }, b: { status: "unavailable", reason: "not_worn" } }).length === 0, "valid metrics pass");
assert(has(validateMetricShapes({ a: { status: "unavailable" } }), "known reason"), "unavailable needs reason");
assert(has(validateMetricShapes({ a: { status: "unavailable", reason: "not_worn", value: 0 } }), "must not carry a value"), "unavailable with 0 value rejected");
assert(has(validateMetricShapes({ a: { status: "measured", unit: "bpm" } }), "finite numeric value"), "measured needs value");
assert(has(validateMetricShapes({ a: { status: "estimated", value: 1, unit: "x" } }), "needs a method"), "estimated needs method");
assert(has(validateMetricShapes({ a: { status: "derived", value: 1, unit: "x", reason: "not_worn" } }), "only unavailable"), "reason only on unavailable");
assert(has(validateMetricShapes({ a: { status: "measured", value: 1, unit: "x", flags: ["bogus"] } }), "unknown flag"), "unknown flag rejected");
assert(has(validateMetricShapes([{ status: "measured", value: NaN as unknown as number, unit: "x" }]), "finite"), "NaN rejected");

// Envelope.
const good = { apiVersion: "1", generatedAt: "2026-10-27T13:00:00+01:00", timezone: "Europe/Oslo", data: { x: 1 } } as Json;
assert(validateEnvelope(good).errors.length === 0, "good envelope");
assert(has(validateEnvelope({ ...(good as object), generatedAt: "2026-10-27T12:00:00Z" } as Json).errors, "explicit offset"), "Z-only instant rejected");
assert(has(validateEnvelope({ apiVersion: "2", error: { code: "internal_error", message: "x" } }).errors, "apiVersion"), "wrong version");
const fail = validateEnvelope({ apiVersion: "1", error: { code: "range_too_large", message: "m" } });
assert(fail.errors.length === 0 && fail.errorCode === "range_too_large", "failure envelope parsed");
assert(validateEnvelope({ apiVersion: "1", error: { code: "nope", message: "m" } }).errors.length > 0, "unknown error code rejected");

// Docs guard.
const docs = SCHEMA_DOC.responses.sync;
assert(has(validateAgainstDoc("sync", docs, [{ status: "synced", stepsRun: 1, syncedThrough: null, lastSyncedAt: null, extra: 1 }], { requireAll: true }), "not documented"), "undocumented field caught");
assert(has(validateAgainstDoc("sync", docs, [{ status: "synced", stepsRun: 1, syncedThrough: null }], { requireAll: true }), "never appears"), "missing documented field caught");
assert(validateAgainstDoc("sync", docs, [{ status: "synced", stepsRun: 1, syncedThrough: null }], { requireAll: false }).length === 0, "requireAll=false tolerates absence");

// Unit, primitive-kind and enum drift are caught.
const dayDocs = SCHEMA_DOC.responses.day;
assert(has(validateAgainstDoc("day", dayDocs, [{ steps: { status: "measured", value: 1, unit: "WRONG" } }], { requireAll: false }), "documents unit steps"), "unit mismatch caught");
assert(has(validateAgainstDoc("day", dayDocs, [{ date: 5 }], { requireAll: false }), "documented as date"), "primitive type mismatch caught");
assert(has(validateAgainstDoc("day", dayDocs, [{ sleep: { main: { status: "weird" } } }], { requireAll: false }), "not among the documented values"), "enum value drift caught");
assert(has(validateAgainstDoc("day", dayDocs, [{ steps: "12" }], { requireAll: false }), "documented as a metric"), "metric documented but plain value caught");

console.log("validate fixture: all assertions passed");
