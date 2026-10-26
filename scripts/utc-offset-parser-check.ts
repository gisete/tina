// Fixture checks for parseUtcOffsetSeconds / normalizer offset wiring.
//   npx tsx scripts/utc-offset-parser-check.ts
import assert from "node:assert/strict";
import { normalizeGoogleSleepSession, parseUtcOffsetSeconds, type GoogleHealthSessionBlock } from "@/lib/google/normalizers";

assert.equal(parseUtcOffsetSeconds("3600s"), 3600, "normal");
assert.equal(parseUtcOffsetSeconds("-18000s"), -18000, "negative");
assert.equal(parseUtcOffsetSeconds("0s"), 0, "zero is 0, not null");
assert.equal(parseUtcOffsetSeconds(undefined), null, "missing");
assert.equal(parseUtcOffsetSeconds(""), null, "empty");
assert.equal(parseUtcOffsetSeconds("abc"), null, "garbage");
assert.equal(parseUtcOffsetSeconds("3600"), null, "no unit");
assert.equal(parseUtcOffsetSeconds(3600), null, "non-string");
assert.equal(parseUtcOffsetSeconds("999999s"), null, "implausible");

const block = (start?: string, end?: string): GoogleHealthSessionBlock => ({
  name: "x",
  sleep: {
    interval: { startTime: "2026-09-29T16:53:00Z", endTime: "2026-09-30T00:30:00Z", startUtcOffset: start, endUtcOffset: end },
    summary: { minutesInSleepPeriod: "457", minutesAsleep: "420", minutesAwake: "37" },
  },
});
const a = normalizeGoogleSleepSession("u", block("28800s", "28800s"));
assert.equal(a?.session.startUtcOffsetSeconds, 28800);
assert.equal(a?.session.endUtcOffsetSeconds, 28800);
assert.equal(a?.session.sleepDate, "2026-09-29", "+8h: 00:53 local on 09-30 -> night of 09-29");
const b = normalizeGoogleSleepSession("u", block());
assert.equal(b?.session.startUtcOffsetSeconds, null);
assert.equal(b?.session.endUtcOffsetSeconds, null);
assert.equal(b?.session.sleepDate, "2026-09-28", "missing offset keeps the old offset-0 sleepDate");
console.log("ok");
