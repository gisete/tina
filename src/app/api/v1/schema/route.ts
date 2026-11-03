import { authenticate, success } from "@/lib/api-server/http";
import { SCHEMA_DOC } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Machine-readable description of every endpoint, field, unit, status and reason. Needs any valid read token. */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request, "read");
  if (!auth.ok) return auth.response;
  return success(SCHEMA_DOC);
}
