// npx tsx src/lib/api/cooldown.fixture.ts
import { decideForceCooldown, FORCE_COOLDOWN_SECONDS } from "./cooldown";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const MIN = 60_000;
const at = (msAgo: number) => decideForceCooldown(NOW, NOW - msAgo);

assert(FORCE_COOLDOWN_SECONDS === 300, "cooldown is 5 minutes");
assert(decideForceCooldown(NOW, null).allowed, "never synced → allowed");

const four = at(4 * MIN);
assert(!four.allowed && four.retryAfterSeconds === 60, `4 min ago → wait 60 s, got ${JSON.stringify(four)}`);
const justNow = at(0);
assert(!justNow.allowed && justNow.retryAfterSeconds === 300, "just synced → wait 300 s");
const almost = at(5 * MIN - 1);
assert(!almost.allowed && almost.retryAfterSeconds === 1, "1 ms short → wait 1 s (rounded up)");
const rounded = at(4 * MIN + 500);
assert(!rounded.allowed && rounded.retryAfterSeconds === 60, "59.5 s remaining rounds up to 60");

assert(at(5 * MIN).allowed, "exactly 5 min → allowed");
assert(at(5 * MIN + 1).allowed, "5 min + 1 ms → allowed");
assert(at(6 * 60 * MIN).allowed, "6 hours ago → allowed");

const future = decideForceCooldown(NOW, NOW + 10 * MIN);
assert(!future.allowed && future.retryAfterSeconds === 300, "stored clock ahead of ours → capped at the cooldown");

console.log("cooldown fixture: all assertions passed");
