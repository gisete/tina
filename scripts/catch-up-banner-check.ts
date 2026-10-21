// Fixture checks for src/lib/sync/catch-up-banner.ts.
//   npx tsx scripts/catch-up-banner-check.ts
import assert from "node:assert/strict";
import {
  BUSY_GIVE_UP_MS, BUSY_POLL_MS, SHOW_AFTER_MS,
  applyResult, bannerView, initialLoopState, parseStepResult, type LoopState,
} from "@/lib/sync/catch-up-banner";
import type { SyncStepResult } from "@/lib/sync/step-types";

const T0 = 1_000_000;
const running = (unit: "recent" | "gap", from: string, to: string, d: number, t: number): SyncStepResult =>
  ({ kind: "running", unit, from, to, daysDone: d, daysTotal: t });

// 1. Plain recent sync: hidden under 2s, inline "Syncing…" after, nothing at idle.
{
  let s = initialLoopState(T0);
  assert.deepEqual(bannerView(s, T0 + SHOW_AFTER_MS - 1), { kind: "hidden" });
  assert.deepEqual(bannerView(s, T0 + SHOW_AFTER_MS), { kind: "inline", label: "Syncing…" });
  let st = applyResult(s, running("recent", "2026-10-18", "2026-10-21", 0, 0), T0 + 500);
  assert.equal(st.action, "call");
  assert.deepEqual(bannerView(st.state, T0 + 600), { kind: "hidden" }); // still plain, still fast
  st = applyResult(st.state, { kind: "idle" }, T0 + 700);
  assert.equal(st.action, "refresh");
  assert.deepEqual(bannerView(st.state, T0 + 700), { kind: "hidden" });
  console.log("1 plain recent: hidden <2s, inline >=2s, idle -> refresh, then hidden");
}

// 2. Idle on the very first call (already up to date): no refresh, nothing shown.
{
  const st = applyResult(initialLoopState(T0), { kind: "idle" }, T0 + 40);
  assert.equal(st.action, "stop");
  assert.deepEqual(bannerView(st.state, T0 + 40), { kind: "hidden" });
  console.log("2 first call idle: stop (no refresh), hidden");
}

// 3. Catch-up progress text, percent, total stays fixed, refresh exactly at idle.
{
  let s: LoopState = initialLoopState(T0);
  const seen: string[] = [];
  const results: SyncStepResult[] = [
    running("recent", "2026-10-18", "2026-10-21", 0, 91),
    running("gap", "2026-07-19", "2026-08-01", 14, 91),
    running("gap", "2026-08-02", "2026-08-15", 28, 91),
    running("gap", "2026-10-11", "2026-10-17", 91, 91),
    running("recent", "2026-10-18", "2026-10-21", 91, 91),
  ];
  let refreshes = 0;
  for (const r of results) {
    const st = applyResult(s, r, T0 + 10);
    assert.equal(st.action, "call");
    s = st.state;
    const v = bannerView(s, T0 + 10);
    assert.equal(v.kind, "catching_up");
    if (v.kind === "catching_up") seen.push(`${v.text} [${v.percent}%]`);
  }
  assert.equal(s.total, 91);
  const idle = applyResult(s, { kind: "idle" }, T0 + 20);
  if (idle.action === "refresh") refreshes++;
  assert.equal(refreshes, 1);
  assert.equal(bannerView(idle.state, T0 + 20).kind, "hidden");
  assert.deepEqual(seen, [
    "Catching up: 0 of 91 days [0%]",
    "Catching up: 07/19 → 08/01, 14 of 91 days [15%]",
    "Catching up: 07/19 → 08/15, 28 of 91 days [31%]",
    "Catching up: 07/19 → 10/17, 91 of 91 days [100%]",
    "Catching up: 07/19 → 10/17, 91 of 91 days [100%]",
  ]);
  console.log("3 catch-up:\n    " + seen.join("\n    "));
}

// 4. auth_required: banner with Reconnect, loop stops. 401 body maps the same way.
{
  const st = applyResult(initialLoopState(T0), { kind: "auth_required" }, T0 + 5);
  assert.equal(st.action, "stop");
  const v = bannerView(st.state, T0 + 5);
  assert.equal(v.kind, "auth_required");
  assert.equal(v.kind === "auth_required" && v.actionLabel, "Reconnect Google");
  console.log("4 auth_required:", JSON.stringify(v));
}

// 5. error / network failure: banner with Retry, loop stops (no automatic retry).
{
  for (const r of [{ kind: "error", message: "Google Health API error [sleep]: 500" } as const, { kind: "network_error", message: "Failed to fetch" } as const]) {
    const st = applyResult(initialLoopState(T0), r, T0 + 5);
    assert.equal(st.action, "stop");
    const v = bannerView(st.state, T0 + 5);
    assert.deepEqual(v, { kind: "error", text: r.message, actionLabel: "Retry" });
  }
  console.log("5 error + network_error -> stop, Retry banner");
}

// 6. busy: poll every BUSY_POLL_MS, give up after BUSY_GIVE_UP_MS with an error banner.
{
  let s = initialLoopState(T0);
  let now = T0;
  let waits = 0;
  for (;;) {
    const st = applyResult(s, { kind: "busy" }, now);
    s = st.state;
    if (st.action === "stop") break;
    assert.equal(st.action, "wait");
    assert.equal(st.delayMs, BUSY_POLL_MS);
    waits++;
    now += BUSY_POLL_MS;
  }
  assert.equal(waits, BUSY_GIVE_UP_MS / BUSY_POLL_MS);
  assert.equal(bannerView(s, now).kind, "error");
  // A running result clears the busy streak.
  const again = applyResult(applyResult(initialLoopState(T0), { kind: "busy" }, T0).state, running("recent", "2026-10-18", "2026-10-21", 0, 0), T0 + 3000);
  assert.equal(again.state.busySinceMs, null);
  console.log(`6 busy: ${waits} polls of ${BUSY_POLL_MS}ms then give up ->`, JSON.stringify(bannerView(s, now)));
}

// 7. busy then idle still refreshes (another sync did the work meanwhile); body validation.
{
  const busy = applyResult(initialLoopState(T0), { kind: "busy" }, T0);
  assert.equal(applyResult(busy.state, { kind: "idle" }, T0 + 3000).action, "refresh");
  assert.deepEqual(parseStepResult({ kind: "idle" }, 200), { kind: "idle" });
  assert.deepEqual(parseStepResult({ kind: "auth_required" }, 401), { kind: "auth_required" });
  for (const bad of [null, {}, { kind: "nope" }, "x", 5]) {
    assert.deepEqual(parseStepResult(bad, 500), { kind: "network_error", message: "Sync failed (HTTP 500)." });
  }
  console.log("7 busy->idle refreshes; malformed bodies -> network_error");
}

console.log("ALL CHECKS PASSED");
