// npx tsx src/lib/api/sync-loop.fixture.ts
import type { SyncStepResult } from "@/lib/sync/step-types";
import { runSyncLoop } from "./sync-loop";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

const running: SyncStepResult = { kind: "running", unit: "recent", from: "2026-10-26", to: "2026-10-28", daysDone: 1, daysTotal: 3 };
function scripted(results: SyncStepResult[], clock = { t: 0, perStep: 0 }) {
  let i = 0;
  let calls = 0;
  return {
    deps: {
      runStep: async (): Promise<SyncStepResult> => { calls += 1; clock.t += clock.perStep; return results[Math.min(i++, results.length - 1)]; },
      nowMs: (): number => clock.t,
    },
    calls: () => calls,
  };
}

async function main(): Promise<void> {
  // Nothing due: one idle step, no work → fresh.
  let s = scripted([{ kind: "idle" }]);
  let r = await runSyncLoop(s.deps);
  assert(r.status === "fresh" && r.stepsRun === 0 && s.calls() === 1, "idle first → fresh");

  // Work then idle → synced with the step count.
  s = scripted([running, running, { kind: "idle" }]);
  r = await runSyncLoop(s.deps);
  assert(r.status === "synced" && r.stepsRun === 2, "work then idle → synced");

  // Step cap: endless work stops at 8 and reports pending.
  s = scripted([running]);
  r = await runSyncLoop(s.deps);
  assert(r.status === "pending" && r.stepsRun === 8 && s.calls() === 8, "8-step cap → pending");

  // Time cap: 20s per step stops after 3 steps (60s >= 45s) even under the step cap.
  s = scripted([running], { t: 0, perStep: 20_000 });
  r = await runSyncLoop(s.deps);
  assert(r.status === "pending" && r.stepsRun === 3, `45s cap → pending after 3 steps, got ${r.stepsRun}`);

  // Lock held (browser sync running) → pending, at the start or mid-way.
  s = scripted([{ kind: "busy" }]);
  r = await runSyncLoop(s.deps);
  assert(r.status === "pending" && r.stepsRun === 0, "busy first → pending");
  s = scripted([running, { kind: "busy" }]);
  r = await runSyncLoop(s.deps);
  assert(r.status === "pending" && r.stepsRun === 1, "busy mid-way → pending");

  // Auth and errors stop immediately with the progress made so far.
  s = scripted([running, { kind: "auth_required" }]);
  r = await runSyncLoop(s.deps);
  assert(r.status === "auth_required" && r.stepsRun === 1, "auth_required");
  s = scripted([{ kind: "error", message: "boom" }]);
  r = await runSyncLoop(s.deps);
  assert(r.status === "error" && r.message === "boom" && r.stepsRun === 0, "error carries message");

  console.log("sync-loop fixture: all assertions passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
