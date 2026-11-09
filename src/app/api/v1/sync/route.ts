import { revalidatePath } from "next/cache";
import { authenticate, failure, success } from "@/lib/api-server/http";
import { formatInstantWithOffset, parseSyncBody, runSyncLoop, type SyncResponseData } from "@/lib/api";
import { runSyncStep } from "@/lib/sync/step";
import { readSyncState } from "@/lib/sync/sync-state";

export const dynamic = "force-dynamic";
// 45 s is a start-gate (no new step begins after it), not a hard deadline: the last step may run on.
// Keep this below the 2-minute sync-lock TTL so a browser sync cannot acquire the lock mid-step.
export const maxDuration = 100;

/**
 * Runs the existing catch-up step in a capped loop. The only write endpoint.
 * Branch on data.status, not the HTTP code: "error" and "auth_required" also answer 200 with this payload.
 * "fresh" means nothing was due and no Google call was made. The sync lock is
 * shared with the browser-triggered sync: if it is held the answer is "pending".
 * Optional JSON body {"force": true} forces the FIRST step (the recent window) regardless of the 6-hour
 * staleness rule; later steps run normally. A forced call never answers "fresh".
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request, "sync");
  if (!auth.ok) return auth.response;
  // Scope is checked above, so a read-only token never gets as far as parsing the body.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return failure("invalid_parameter", "The request body could not be read.");
  }
  const body = parseSyncBody(rawBody);
  if (!body.ok) return failure(body.code, body.message);
  try {
    const outcome = await runSyncLoop(
      {
        runStep: ({ force }) => runSyncStep(auth.userId, { force }),
        nowMs: () => Date.now(),
      },
      { force: body.value.force },
    );
    if (outcome.stepsRun > 0) {
      revalidatePath("/dashboard");
      revalidatePath("/dashboard/sleep");
      revalidatePath("/dashboard/heart");
      revalidatePath("/dashboard/today");
    }
    // A failed read after the loop must not hide the steps that ran.
    const state = await readSyncState(auth.userId).catch(() => ({ syncedThrough: null, lastSyncedAtMs: null }));
    const data: SyncResponseData = {
      status: outcome.status,
      stepsRun: outcome.stepsRun,
      syncedThrough: state.syncedThrough,
      lastSyncedAt:
        state.lastSyncedAtMs === null ? null : formatInstantWithOffset(state.lastSyncedAtMs, -new Date().getTimezoneOffset() * 60),
      ...(outcome.status === "error" ? { message: outcome.message } : {}),
    };
    return success(data);
  } catch (e) {
    console.error("[api/v1/sync]", e instanceof Error ? e.message : e);
    return failure("internal_error", "Sync could not be started.");
  }
}
