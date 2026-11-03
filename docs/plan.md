# Plan — agent-readable data API

Goal: a local AI agent on the user's server reads their health data through a token-authenticated, versioned JSON API, and can trigger a sync. Focus is data, not UI. Rules for working this plan are in AGENTS.md ("Autonomous work rules"). Status values: todo / in progress / done / blocked: <question>.

Not in scope: deploying to the server (handled separately by the server's admin agent) and anything UI.

## Task 0 — the harness
Status: done
1. docs/plan.md (this file) and docs/progress.md.
2. npm script `check`: `tsc --noEmit`, `npm run lint` (zero warnings), `npm run build`, then every `src/**/*.fixture.ts` via `npx tsx`, failing fast. Lint fully clean (fix the react-hooks/purity `Date.now()` in the gap-trend tooltip by passing `now` in as a prop computed by the caller).
3. "Autonomous work rules" section in AGENTS.md.
4. Confirm the code-reviewer subagent is registered. (Confirmed: `.claude/agents/code-reviewer.md`.)

## Task 1 — Commit the pending heart-trend baseline work
Status: done
Commit as it stands ("rolling 7-reading baseline on heart cards"). No code changes.

## Task 2 — Prompt B: move /api/sync?days=N onto the chunked sync path
Status: done (already implemented before this plan; verified, not re-run)
Move `/api/sync?days=N` onto the chunked civil-date sync path (`src/lib/sync/step.ts`), then delete `runGoogleSync` and the unused `shouldAutoSync`, and merge the duplicate 6-hour staleness constants into one. Acceptance: no caller of `runGoogleSync` remains; before and after running `?days=30`, a read-only snapshot of `daily_activity_summaries` shows no AZM value decreased and no day lost data. Report the diff.

## Task 3 — Honest absence, data layer only
Status: blocked: schema change committed but NOT pushed — OK to run `npx drizzle-kit push` to drop NOT NULL/DEFAULT 0 on the four AZM columns of daily_activity_summaries? (diff in progress.md)
In `src/lib/api/` (pure TS) define a discriminated union for every exposed metric value:
`{ status: "measured", value, unit } | { status: "estimated", value, unit, method } | { status: "derived", value, unit } | { status: "unavailable", reason: "not_worn" | "not_synced" | "not_fetched" | "not_supported" | "partial_day" }`.
Absence is decided by the sync cursor: a date on or before `synced_through` with no data is `not_worn`; after it, `not_synced`; today's partial values are measured but flagged `partial_day` where relevant. Add a pure classifier with fixtures. Make the AZM columns on `daily_activity_summaries` nullable (drop DEFAULT 0) so absence stops reading as zero. This alters an existing table: write the change, show the schema diff, and STOP before `drizzle-kit push`.

## Task 4 — AZM light-minutes investigation (read-only)
Status: blocked: findings written (progress.md) from code, docs and stored data, but no raw API sample — OK to run a one-off read-only script that calls the existing zone fetch (and `daily-heart-rate-zones`) for one day? It is a Google call outside the sync path and may refresh the OAuth token (a write to the `account` table).
`light_minutes` is ~1,270–1,430/day (≈ all worn time) while moderate/vigorous/peak are mostly 0. Diagnose the zone mapping from the code and a raw API response sample; report cause and proposed fix in progress.md. Do not change the mapping.

## Task 5 — Agent authentication
Status: todo
New table `api_tokens`: id, user_id, name, token_hash (SHA-256; plaintext never stored), scopes (text[] of "read" | "sync"), created_at, last_used_at, revoked_at. Pure verifier in `src/lib/api/` (hash compare, revoked check, scope check) with fixtures. `scripts/create-api-token.ts` (name + scopes; prints plaintext once, stores only the hash) and `scripts/revoke-api-token.ts`. Do not run either against the real DB — STOP and ask the user to create a token with scopes read,sync and put it in `.env.local` as `TINA_API_TOKEN`. The Auth.js middleware must not redirect `/api/v1/*` to login; those routes authenticate by Bearer token only.

## Task 6 — API contract
Status: todo
In `src/lib/api/`, pure TS response types and builders (primitives in, plain JSON out, no Next imports). One envelope: `{ apiVersion: "1", generatedAt (instant with offset), timezone, data }` on success, or `{ apiVersion: "1", error: { code, message } }` on failure, as a discriminated union. Every metric uses the Task 3 union, with its unit. Derived values (sleep score and breakdown, debt, restlessness est., cardiac strain) are computed live by the existing engines — reuse them, never reimplement or change their math.

## Task 7 — Read endpoints (scope "read")
Status: todo
DB-only, no Google calls under any circumstance, including no lazy HR-sample fetch: sample-derived fields for a night without stored samples return unavailable/not_fetched.
- `GET /api/v1/day?date=YYYY-MM-DD` (default today, local): main sleep session plus naps (reuse existing main-session selection), stages, sleep score and breakdown, night HR summary and estimated restlessness when samples exist, RHR, HRV, steps, AZM.
- `GET /api/v1/days?from=&to=`: same per-day shape over a range, capped at 92 days (`range_too_large` beyond).
- `GET /api/v1/state`: sleep debt, circadian variance, sync status (last_synced_at, synced_through, whether Google auth is valid as last known, without calling Google).
The API sleep score for a night must equal what the dashboard shows for that night: use the dashboard's exact call.

## Task 8 — Sync endpoint (scope "sync")
Status: todo
`POST /api/v1/sync` runs the existing step function in a server-side loop, capped at 8 steps or 45 seconds, returns `{ status: "fresh" | "synced" | "pending" | "auth_required" | "error", stepsRun, syncedThrough, lastSyncedAt }`. If the 6-hour staleness rule says nothing is due and there is no gap, return "fresh" without calling Google. If the existing lock is held, return "pending". No other write endpoints.

## Task 9 — GET /api/v1/schema
Status: todo
Valid read token required. Machine-readable description of every endpoint, parameter, field, unit, and the meaning of each status and reason value, generated from or kept beside the contract types so it cannot drift silently. Field descriptions written for an AI reader: what each metric means and how it is estimated where relevant.

## Task 10 — Contract smoke test
Status: todo
Added to `npm run check`, skipped with a clear message if `TINA_API_TOKEN` is absent. Starts nothing itself; expects the dev server running. Calls every read endpoint (day for today, yesterday, and a date before synced history begins; days for a 7-day and an over-cap range; state; schema), validates each response against the contract types at runtime, and asserts: over-cap range returns `range_too_large`; a date with no data returns unavailable values with a reason (never 0); the API sleep score for 3 recent nights equals the dashboard's. Must not call `/api/v1/sync`.
