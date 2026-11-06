// npx tsx src/lib/timezone-guard.fixture.ts
import { EXPECTED_TIMEZONE, timezoneMessage, timezoneVerdict } from "./timezone-guard";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

assert(EXPECTED_TIMEZONE === "Europe/Lisbon", "expected zone is Europe/Lisbon");
assert(timezoneVerdict("Europe/Lisbon", "production") === "ok", "right zone, production: ok");
assert(timezoneVerdict("Europe/Lisbon", "development") === "ok", "right zone, development: ok");
assert(timezoneVerdict("UTC", "production") === "throw", "UTC in production throws");
assert(timezoneVerdict("UTC", "development") === "warn", "UTC in development warns");
assert(timezoneVerdict("UTC", undefined) === "warn", "unset NODE_ENV warns");
assert(timezoneVerdict("Europe/London", "production") === "throw", "any other zone in production throws");
assert(timezoneMessage("UTC").includes('"UTC"') && timezoneMessage("UTC").includes("Europe/Lisbon"), "message names both zones");
console.log("timezone-guard fixture: ok");
