// npx tsx src/lib/api/sync-request.fixture.ts
import { parseSyncBody } from "./sync-request";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

function force(raw: string): boolean | "invalid" {
  const r = parseSyncBody(raw);
  return r.ok ? r.value.force : (assert(r.code === "invalid_parameter" && r.message.length > 0, `invalid code for ${raw}`), "invalid");
}

assert(force("") === false, "empty body → no force");
assert(force("  \n") === false, "blank body → no force");
assert(force("{}") === false, "{} → no force");
assert(force('{"force":false}') === false, "force false");
assert(force('{"force":true}') === true, "force true");
assert(force('{"force":true,"other":1}') === true, "extra keys ignored");
assert(force("not json") === "invalid", "not JSON");
assert(force("{") === "invalid", "truncated JSON");
assert(force("true") === "invalid", "JSON non-object");
assert(force("null") === "invalid", "null");
assert(force("[]") === "invalid", "array");
assert(force('{"force":"true"}') === "invalid", "string force");
assert(force('{"force":1}') === "invalid", "number force");
assert(force('{"force":null}') === "invalid", "null force");

console.log("sync-request fixture: all assertions passed");
