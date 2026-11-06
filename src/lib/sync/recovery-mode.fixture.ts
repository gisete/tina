// npx tsx src/lib/sync/recovery-mode.fixture.ts
import {
  MAX_EXERCISE_BACKFILL_DAYS,
  MAX_RECOVERY_DAYS,
  maxRecoveryDays,
  parseRecoveryDays,
  parseRecoveryMode,
  planRecoveryRange,
} from "./catch-up";

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

const full = parseRecoveryMode(null);
const only = parseRecoveryMode("exercise");
assert(full !== null && full.kind === "full", "absent ?only is the full path");
assert(only !== null && only.kind === "exercise-only", "?only=exercise is exercise-only");
for (const bad of ["", "all", "Exercise", "sleep", "exercise,sleep"]) {
  assert(parseRecoveryMode(bad) === null, `only=${JSON.stringify(bad)} is refused`);
}

assert(MAX_RECOVERY_DAYS === 120 && MAX_EXERCISE_BACKFILL_DAYS === 240, "caps: 120 full, 240 exercise-only");
assert(maxRecoveryDays(full!) === 120 && maxRecoveryDays(only!) === 240, "cap follows the mode");

// The full path is unchanged; exercise-only accepts up to 240.
assert(parseRecoveryDays("120") === 120, "full accepts 120 by default");
assert(parseRecoveryDays("121") === null, "full refuses 121");
assert(parseRecoveryDays("121", full!) === null, "full refuses 121 explicitly");
assert(parseRecoveryDays("240", only!) === 240, "exercise-only accepts 240");
assert(parseRecoveryDays("241", only!) === null, "exercise-only refuses 241");
assert(parseRecoveryDays("0", only!) === null && parseRecoveryDays("abc", only!) === null, "non-positive / non-numeric refused");

// 240 days back from 2026-11-06 starts 2026-03-11, so it covers the first workout on 2026-03-21.
const plan = planRecoveryRange("2026-11-06", 240);
assert(plan[0].from === "2026-03-11", `starts 2026-03-11, got ${plan[0].from}`);
assert(plan[0].from <= "2026-03-21", "covers 2026-03-21");
assert(plan[plan.length - 1].to === "2026-11-06", "ends today");
assert(plan.length === 18 && plan.every((c) => c.days <= 14), "18 chunks of at most 14 days");

console.log("recovery-mode fixture: ok");
