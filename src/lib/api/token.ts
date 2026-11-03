// Bearer-token verification for /api/v1 — pure apart from node:crypto hashing.
// No React/Next/DB imports. The route looks the record up by hashToken(plaintext)
// and hands it here; this module owns the checks and their order.

import { createHash, timingSafeEqual } from "node:crypto";

export type ApiScope = "read" | "sync";
export const API_SCOPES: readonly ApiScope[] = ["read", "sync"];
export const TOKEN_PREFIX = "tina_";

export function isApiScope(s: string): s is ApiScope {
  return (API_SCOPES as readonly string[]).includes(s);
}

/** Lowercase hex SHA-256 of a token. */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** The token from an `Authorization: Bearer <token>` header, or null if absent/malformed. */
export function extractBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

/** The stored side of a token (an api_tokens row, with instants as epoch ms). */
export interface TokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  scopes: readonly ApiScope[];
  revokedAtMs: number | null;
}

export type TokenFailure = "missing" | "invalid" | "revoked" | "insufficient_scope";

export type TokenVerdict =
  | { ok: true; tokenId: string; userId: string; scopes: readonly ApiScope[] }
  | { ok: false; reason: TokenFailure };

function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Decides whether a request may proceed. `record` is the row found by hash (or
 * null when none matched). The presented token is re-hashed and compared in
 * constant time even though the lookup was by hash, so a bad lookup can never
 * authenticate. Order: missing → invalid → revoked → scope.
 */
export function verifyApiToken(input: {
  authorization: string | null | undefined;
  record: TokenRecord | null;
  requiredScope: ApiScope;
}): TokenVerdict {
  const presented = extractBearer(input.authorization);
  if (presented === null) return { ok: false, reason: "missing" };
  const { record } = input;
  if (record === null || !hashesEqual(hashToken(presented), record.tokenHash)) return { ok: false, reason: "invalid" };
  if (record.revokedAtMs !== null) return { ok: false, reason: "revoked" };
  if (!record.scopes.includes(input.requiredScope)) return { ok: false, reason: "insufficient_scope" };
  return { ok: true, tokenId: record.id, userId: record.userId, scopes: record.scopes };
}
