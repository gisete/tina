// npx tsx src/lib/api/sync-loop.fixture.ts
import type { SyncStepResult } from "@/lib/sync/step-types";
import { runSyncLoop } from "./sync-loop";

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

const running: SyncStepResult = { kind: "running", unit: "recent", from: "2026-10-26", to: "2026-10-28", daysDone: 1, daysTotal: 3 };
function scripted(results: SyncStepResult[], clock = { t: 0, perStep: 0 }) {
  let i = 0;
  let calls = 0;
  const forces: boolean[] = [];
  return {
    forces,
    deps: {
      runStep: async (opts: { force: boolean }): Promise<SyncStepResult> => { calls += 1; forces.push(opts.force); clock.t += clock.perStep; return results[Math.min(i++, results.length - 1)]; },
      nowMs: (): number => clock.t,
    },
    calls: () => calls,
  };
}

async function main(): Promise<void> {
  // Nothing due: one idle step, no work → fresh.
  let s = scripted([{ kind: "idle" }]);
  let r = await runSyncLoop(s.deps, { force: false });
  assert(r.status === "fresh" && r.stepsRun === 0 && s.calls() === 1, "idle first → fresh");

  // Work then idle → synced with the step count.
  s = scripted([running, running, { kind: "idle" }]);
  r = await runSyncLoop(s.deps, { force: false });
  assert(r.status === "synced" && r.stepsRun === 2, "work then idle → synced");

  // Step cap: endless work stops at 8 and reports pending.
  s = scripted([running]);
  r = await runSyncLoop(s.deps, { force: false });
  assert(r.status === "pending" && r.stepsRun === 8 && s.calls() === 8, "8-step cap → pending");

  // Time cap: 20s per step stops after 3 steps (60s >= 45s) even under the step cap.
  s = scripted([running], { t: 0, perStep: 20_000 });
  r = await runSyncLoop(s.deps, { force: false });
  assert(r.status === "pending" && r.stepsRun === 3, `45s cap → pending after 3 steps, got ${r.stepsRun}`);

  // Lock held (browser sync running) → pending, at the start or mid-way.
  s = scripted([{ kind: "busy" }]);
  r = await runSyncLoop(s.deps, { force: false });
  assert(r.status === "pending" && r.stepsRun === 0, "busy first → pending");
  s = scripted([running, { kind: "busy" }]);
  r = await runSyncLoop(s.deps, { force: false });
  assert(r.status === "pending" && r.stepsRun === 1, "busy mid-way → pending");

  // Auth and errors stop immediately with the progress made so far.
  s = scripted([running, { kind: "auth_required" }]);
  r = await runSyncLoop(s.deps, { force: false });
  assert(r.status === "auth_required" && r.stepsRun === 1, "auth_required");
  s = scripted([{ kind: "error", message: "boom" }]);
  r = await runSyncLoop(s.deps, { force: false });
  assert(r.status === "error" && r.message === "boom" && r.stepsRun === 0, "error carries message");

  // Force: only the first step is forced; later steps run unforced.
  s = scripted([running, running, running, { kind: "idle" }]);
  r = await runSyncLoop(s.deps, { force: true });
  assert(s.forces.length === 4, `4 calls, got ${s.forces.length}`);
  assert(s.forces[0] === true && s.forces.slice(1).every((f) => f === false), `only call 1 forced: ${s.forces.join(",")}`);
  assert(r.status === "synced" && r.stepsRun === 3, "forced then work then idle → synced");

  // Force at the step cap: still only the first call forced.
  s = scripted([running]);
  r = await runSyncLoop(s.deps, { force: true });
  assert(s.forces.length === 8 && s.forces[0] === true && s.forces.slice(1).every((f) => !f), "cap run: one forced call");
  assert(r.status === "pending", "forced run hitting the cap → pending");

  // No force: no call is forced.
  s = scripted([running, running, { kind: "idle" }]);
  await runSyncLoop(s.deps, { force: false });
  assert(s.forces.length === 3 && s.forces.every((f) => f === false), "force=false → no call forced");

  // Forced first step then idle → synced (never fresh).
  s = scripted([running, { kind: "idle" }]);
  r = await runSyncLoop(s.deps, { force: true });
  assert(r.status === "synced" && r.stepsRun === 1 && s.forces[0] === true && s.forces[1] === false, "forced step then idle → synced");

  // Defensive: even an idle first step never reads as "fresh" when forced.
  s = scripted([{ kind: "idle" }]);
  r = await runSyncLoop(s.deps, { force: true });
  assert(r.status === "synced", "forced + idle first → synced, not fresh");

  // Forced but the lock is held → pending; the error variant still carries its message.
  s = scripted([{ kind: "busy" }]);
  r = await runSyncLoop(s.deps, { force: true });
  assert(r.status === "pending" && r.stepsRun === 0, "forced + busy → pending");
  s = scripted([{ kind: "error", message: "boom" }]);
  r = await runSyncLoop(s.deps, { force: true });
  assert(r.status === "error" && r.message === "boom", "forced + error → error with message");

  console.log("sync-loop fixture: all assertions passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
