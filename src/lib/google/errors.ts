/**
 * Thrown when Google access can't be recovered without the user signing in
 * again: revoked/expired refresh token (invalid_grant), no linked account or
 * refresh token, or a 401 that survives a token refresh. Callers map it to an
 * "auth required" state instead of a generic error.
 */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}
