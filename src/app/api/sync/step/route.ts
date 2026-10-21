import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { runSyncStep } from "@/lib/sync/step";
import type { SyncStepRequest, SyncStepResult } from "@/lib/sync/step-types";

/** Parses the optional JSON body into a typed request; anything malformed is ignored. */
function parseRequest(body: unknown): SyncStepRequest {
  if (typeof body !== "object" || body === null) return {};
  const { force, previousTotal } = body as Record<string, unknown>;
  return {
    force: force === true,
    previousTotal:
      typeof previousTotal === "number" && Number.isFinite(previousTotal) && previousTotal >= 0
        ? Math.floor(previousTotal)
        : 0,
  };
}

export async function POST(request: Request): Promise<NextResponse<SyncStepResult>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json<SyncStepResult>({ kind: "auth_required" }, { status: 401 });
  }

  const req = parseRequest(await request.json().catch(() => null));
  const result = await runSyncStep(session.user.id, req);

  if (result.kind === "running") {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/sleep");
    revalidatePath("/dashboard/heart");
    revalidatePath("/dashboard/today");
  }
  return NextResponse.json<SyncStepResult>(result);
}
