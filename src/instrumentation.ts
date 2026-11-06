import { timezoneMessage, timezoneVerdict } from "@/lib/timezone-guard";

/** Runs once at server start. Refuses to serve in production with the wrong process timezone. */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const actual = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const verdict = timezoneVerdict(actual, process.env.NODE_ENV);
  if (verdict === "throw") throw new Error(timezoneMessage(actual));
  if (verdict === "warn") console.warn(timezoneMessage(actual));
}
