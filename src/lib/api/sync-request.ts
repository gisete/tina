// Body of POST /api/v1/sync — pure. The body is optional: absent or blank means { force: false }.

import type { ParseResult } from "./params";

export interface SyncRequestOptions {
  force: boolean;
}

/**
 * Parses the raw request body text. Accepts "" (no body) or a JSON object whose
 * optional `force` is a boolean; other keys are ignored. Anything else is
 * `invalid_parameter` (not JSON, not an object, `force` not a boolean).
 */
export function parseSyncBody(raw: string): ParseResult<SyncRequestOptions> {
  if (raw.trim() === "") return { ok: true, value: { force: false } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_parameter", message: "The request body must be valid JSON, for example {\"force\":true}, or empty." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: "invalid_parameter", message: "The request body must be a JSON object, for example {\"force\":true}." };
  }
  const force = (parsed as Record<string, unknown>).force;
  if (force === undefined) return { ok: true, value: { force: false } };
  if (typeof force !== "boolean") {
    return { ok: false, code: "invalid_parameter", message: "force must be a boolean (true or false)." };
  }
  return { ok: true, value: { force } };
}
