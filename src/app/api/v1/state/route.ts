import { authenticate, failure, success } from "@/lib/api-server/http";
import { loadState } from "@/lib/api-server/read-state";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request, "read");
  if (!auth.ok) return auth.response;
  try {
    return success(await loadState(auth.userId));
  } catch (e) {
    console.error("[api/v1/state]", e instanceof Error ? e.message : e);
    return failure("internal_error", "Could not read state.");
  }
}
