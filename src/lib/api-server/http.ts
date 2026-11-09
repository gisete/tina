// HTTP edge for /api/v1: bearer authentication and envelope responses.
// DB reads only. Deliberately does NOT write api_tokens.last_used_at: that would
// be a database write outside the sync path (see docs/progress.md, Task 7).

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apiTokens } from "@/db/schema";
import {
  buildFailure,
  buildSuccess,
  extractBearer,
  hashToken,
  verifyApiToken,
  type ApiErrorCode,
  type ApiScope,
} from "@/lib/api";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  insufficient_scope: 403,
  invalid_parameter: 400,
  range_too_large: 400,
  not_found: 404,
  cooldown: 429,
  internal_error: 500,
};

export function failure(code: ApiErrorCode, message: string): Response {
  return Response.json(buildFailure(code, message), { status: STATUS[code], headers: { "Cache-Control": "no-store" } });
}

/** 429 for a forced sync inside the cooldown: envelope with retryAfterSeconds plus a Retry-After header. */
export function cooldownFailure(retryAfterSeconds: number): Response {
  return Response.json(
    buildFailure("cooldown", `A sync finished less than 5 minutes ago. Try again in ${retryAfterSeconds} seconds.`, { retryAfterSeconds }),
    { status: STATUS.cooldown, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) } },
  );
}

export function success<T>(data: T): Response {
  const now = new Date();
  return Response.json(
    buildSuccess(data, {
      nowMs: now.getTime(),
      offsetSeconds: -now.getTimezoneOffset() * 60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}

export type AuthResult = { ok: true; userId: string } | { ok: false; response: Response };

/** Bearer-only. A session cookie never authenticates an /api/v1 call. */
export async function authenticate(request: Request, scope: ApiScope): Promise<AuthResult> {
  const authorization = request.headers.get("authorization");
  const presented = extractBearer(authorization);
  let row;
  try {
    row = presented
      ? await db.query.apiTokens.findFirst({ where: eq(apiTokens.tokenHash, hashToken(presented)) })
      : undefined;
  } catch (e) {
    console.error("[api/v1] token lookup failed:", e instanceof Error ? e.message : e);
    return { ok: false, response: failure("internal_error", "Could not verify the token.") };
  }
  const verdict = verifyApiToken({
    authorization,
    record: row
      ? { id: row.id, userId: row.userId, tokenHash: row.tokenHash, scopes: row.scopes, revokedAtMs: row.revokedAt?.getTime() ?? null }
      : null,
    requiredScope: scope,
  });
  if (verdict.ok) return { ok: true, userId: verdict.userId };
  if (verdict.reason === "insufficient_scope") {
    return { ok: false, response: failure("insufficient_scope", `This token lacks the "${scope}" scope.`) };
  }
  return { ok: false, response: failure("unauthorized", "Missing, invalid, or revoked bearer token.") };
}
