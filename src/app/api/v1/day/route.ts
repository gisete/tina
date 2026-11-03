import { authenticate, failure, success } from "@/lib/api-server/http";
import { loadDays } from "@/lib/api-server/read-days";
import { parseDayParams } from "@/lib/api";
import { localToday } from "@/lib/dates";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request, "read");
  if (!auth.ok) return auth.response;
  try {
    const parsed = parseDayParams({ date: new URL(request.url).searchParams.get("date") }, localToday());
    if (!parsed.ok) return failure(parsed.code, parsed.message);
    const [day] = await loadDays(auth.userId, parsed.value.date, parsed.value.date);
    return success(day);
  } catch (e) {
    console.error("[api/v1/day]", e instanceof Error ? e.message : e);
    return failure("internal_error", "Could not read this day.");
  }
}
