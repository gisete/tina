import { authenticate, failure, success } from "@/lib/api-server/http";
import { loadDays } from "@/lib/api-server/read-days";
import { parseRangeParams } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request, "read");
  if (!auth.ok) return auth.response;
  try {
    const p = new URL(request.url).searchParams;
    const parsed = parseRangeParams({ from: p.get("from"), to: p.get("to") });
    if (!parsed.ok) return failure(parsed.code, parsed.message);
    const days = await loadDays(auth.userId, parsed.value.from, parsed.value.to);
    return success({ from: parsed.value.from, to: parsed.value.to, days });
  } catch (e) {
    console.error("[api/v1/days]", e instanceof Error ? e.message : e);
    return failure("internal_error", "Could not read this range.");
  }
}
