// Pure decision for the startup timezone guard (see src/instrumentation.ts).
// Local-date helpers (src/lib/dates.ts) read the process timezone, so the
// server must run in the timezone the app is built for.

/** The only timezone the app supports. */
export const EXPECTED_TIMEZONE = "Europe/Lisbon";

export type TimezoneVerdict = "ok" | "warn" | "throw";

/** Mismatch is fatal in production and a warning everywhere else. */
export function timezoneVerdict(actual: string, nodeEnv: string | undefined): TimezoneVerdict {
  if (actual === EXPECTED_TIMEZONE) return "ok";
  return nodeEnv === "production" ? "throw" : "warn";
}

export function timezoneMessage(actual: string): string {
  return `[tina] Process timezone is "${actual}", expected "${EXPECTED_TIMEZONE}". Local calendar dates would be wrong; start with TZ=${EXPECTED_TIMEZONE} (the npm scripts and the Docker image do).`;
}
