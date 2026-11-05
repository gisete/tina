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
Status: done — the zone-mapping theory was disproved by the Task 12 probes (see progress.md correction).
`light_minutes` is ~1,270–1,430/day (≈ all worn time) while moderate/vigorous/peak are mostly 0. Diagnose the zone mapping from the code and a raw API response sample; report cause and proposed fix in progress.md. Do not change the mapping.

## Task 5 — Agent authentication
Status: done (code). USER ACTION: `npx drizzle-kit push` (creates api_tokens; also applies the Task 3 AZM nullability), then `npx tsx scripts/create-api-token.ts agent read,sync`, and put the printed token in .env.local as TINA_API_TOKEN.
New table `api_tokens`: id, user_id, name, token_hash (SHA-256; plaintext never stored), scopes (text[] of "read" | "sync"), created_at, last_used_at, revoked_at. Pure verifier in `src/lib/api/` (hash compare, revoked check, scope check) with fixtures. `scripts/create-api-token.ts` (name + scopes; prints plaintext once, stores only the hash) and `scripts/revoke-api-token.ts`. Do not run either against the real DB — STOP and ask the user to create a token with scopes read,sync and put it in `.env.local` as `TINA_API_TOKEN`. The Auth.js middleware must not redirect `/api/v1/*` to login; those routes authenticate by Bearer token only.

## Task 6 — API contract
Status: done
In `src/lib/api/`, pure TS response types and builders (primitives in, plain JSON out, no Next imports). One envelope: `{ apiVersion: "1", generatedAt (instant with offset), timezone, data }` on success, or `{ apiVersion: "1", error: { code, message } }` on failure, as a discriminated union. Every metric uses the Task 3 union, with its unit. Derived values (sleep score and breakdown, debt, restlessness est., cardiac strain) are computed live by the existing engines — reuse them, never reimplement or change their math.

## Task 7 — Read endpoints (scope "read")
Status: done (code + DB-level verification; HTTP end-to-end waits for the api_tokens push and a token)
DB-only, no Google calls under any circumstance, including no lazy HR-sample fetch: sample-derived fields for a night without stored samples return unavailable/not_fetched.
- `GET /api/v1/day?date=YYYY-MM-DD` (default today, local): main sleep session plus naps (reuse existing main-session selection), stages, sleep score and breakdown, night HR summary and estimated restlessness when samples exist, RHR, HRV, steps, AZM.
- `GET /api/v1/days?from=&to=`: same per-day shape over a range, capped at 92 days (`range_too_large` beyond).
- `GET /api/v1/state`: sleep debt, circadian variance, sync status (last_synced_at, synced_through, whether Google auth is valid as last known, without calling Google).
The API sleep score for a night must equal what the dashboard shows for that night: use the dashboard's exact call.

## Task 8 — Sync endpoint (scope "sync")
Status: done (code + stub-driven fixture; not called against Google — see progress.md)
`POST /api/v1/sync` runs the existing step function in a server-side loop, capped at 8 steps or 45 seconds, returns `{ status: "fresh" | "synced" | "pending" | "auth_required" | "error", stepsRun, syncedThrough, lastSyncedAt }`. If the 6-hour staleness rule says nothing is due and there is no gap, return "fresh" without calling Google. If the existing lock is held, return "pending". No other write endpoints.

## Task 9 — GET /api/v1/schema
Status: done
Valid read token required. Machine-readable description of every endpoint, parameter, field, unit, and the meaning of each status and reason value, generated from or kept beside the contract types so it cannot drift silently. Field descriptions written for an AI reader: what each metric means and how it is estimated where relevant.

## Task 10 — Contract smoke test
Status: done (skips without TINA_API_TOKEN; not yet run against a live server — see progress.md)
Added to `npm run check`, skipped with a clear message if `TINA_API_TOKEN` is absent. Starts nothing itself; expects the dev server running. Calls every read endpoint (day for today, yesterday, and a date before synced history begins; days for a 7-day and an over-cap range; state; schema), validates each response against the contract types at runtime, and asserts: over-cap range returns `range_too_large`; a date with no data returns unavailable values with a reason (never 0); the API sleep score for 3 recent nights equals the dashboard's. Must not call `/api/v1/sync`.

## Task 11 — Honest zone data in the API (withhold AZM, label heart zones)
Status: done (the AZM withholding half was reverted by Task 12c; the heartZoneMinutes half stands)
`heartZoneMinutes` stays `measured`, but its schema description says these are Google's per-day Karvonen heart-rate zones, not Fitbit's fat-burn/cardio/peak zones, and that `light` covers most worn time by design. `activeZoneMinutes` is withheld: `/api/v1/day` and `/api/v1/days` return `status: "unavailable", reason: "not_supported"` with no value, and the schema doc says the same. Stored AZM data and the metric math (`calculateActiveZoneMinutes`, the dashboard's AZM card) are untouched.

## Task 12 — Real active zone minutes from Google (PLAN ONLY)
Status: closed: not a bug — the derived AZM matches Google's active-zone-minutes dailyRollUp within ±2 min on all 12 sampled days, so no new table and no backfill (probe data: 7311f33, plus 6e420ae).

## Task 12c — Revert the Task 11 AZM withholding
Status: done
`activeZoneMinutes` is `status: "derived"` again, with its value from `calculateActiveZoneMinutes` (same as the dashboard card). The schema doc says it is computed from Google's per-day Karvonen zone minutes (moderate x1, vigorous/peak x2) and matches Google's own AZM within about 2 minutes, not exactly. Fixtures and smoke test updated. The Task 11 `heartZoneMinutes` descriptions stay.

Rules for Tasks 13–18: AGENTS.md conventions, local-timezone date helpers only, no `any`, one commit per task, done only when `npm run check` passes and `code-reviewer` has reviewed it. Task 12 is closed (not a bug); Task 13 may start.

## Task 13 — Exercise probe (read-only, STOP after)
Status: done (evidence commit 0e07c29)
A one-off script, in the style of the AZM probe, that calls Google for the last 30 days and saves the raw responses to `docs/exercise-probe/`, with no tokens in output. Fetch: exercise data points; the total-calories daily rollup; active-energy-burned for one workout's window; heart-rate for one workout's window.
Report: which fields the Charge 6 actually fills in (calories, distance, steps, avg HR, AZM, activeDuration, splits, exerciseEvents); the recording method, and whether auto-detected walks show up separately from workouts started by hand; whether the current OAuth scopes are enough without re-consent; how many workouts exist in the DB-covered history range; whether the existing heart-rate samples table can hold workout samples without altering any table or column; how a session's per-workout AZM compares with the active-zone-minutes data the Task 12 fix uses. STOP for approval.

## Task 14 — Schema (new tables only)
Status: schema written, awaiting `drizzle-kit push` by the user
Decisions (from the Task 13 probe, evidence in `docs/exercise-probe/`, commit `0e07c29`): workout HR goes in the **existing `heart_rate_samples` table, no new table**; workouts join to samples by time range.
Two new tables, no change to any existing table or column:
- `exercise_sessions`: unique on user_id + Google data point ID. Columns: Google data point ID; local `exercise_date` (from the session's start time + startUtcOffset; Google gives no civil start time on the point); type; display name; start/end; active duration in seconds; session calories (Google's own figure, never summed from active-energy points); distance in meters; steps; avg HR; avg pace; AZM; Google's four zone durations (light/moderate/vigorous/peak); recording method. Nullable wherever the probe showed a field can be missing (distance, steps, pace, zone durations, AZM, display name, events-derived values). Every recording method is stored, including passive and manual; filtering is a UI concern.
- `daily_energy`: user_id + date, total calories and active calories per day.
Report the push diff and STOP; the user runs `drizzle-kit push`.

## Task 15 — Sync
Status: not started
Inside the existing sync window, fetch exercise sessions and daily energy. Exercise queries filter on `exercise.interval.civil_start_time` (the probe showed `start_time` is rejected with a 400; page size max 25). Delete-and-replace sessions within the fetched window so deletions and edits in Google carry over. Fetch HR samples for each workout window at sync time into `heart_rate_samples`. Keep it inside the 3-day sync and the existing `?days=N` recovery path; no Google calls on any read path. Overlap rule: when storing workout HR samples, skip any sample whose timestamp falls inside a stored `sleep_sessions` window (`start_time` to `end_time`, any session type). A night's samples come only from the night fetch (`ensureNightSamples` stays unchanged). The filter is a pure function in `src/lib/`, with a fixture: a workout overlapping a night's end by 10 minutes stores only the non-overlapping samples. (Task 13 data: 1 of the 28 workouts in the 30-day list overlaps a stored sleep window, 2026-10-15 walk, 29.4 min.) The historical HR backfill runs sequentially through the recovery path, with a short pause between calls. Report how many extra Google calls a normal sync now makes.

## Task 16 — Engine
Status: not started
Pure `src/lib/analytics/exercise.ts`, primitives in and out. Per-workout derived stats: pace and speed from activeDuration (never end minus start), HR min/avg/max from samples, time in each Google zone using the same Karvonen zones and naming caveat as `heartZoneMinutes`. Session calories are Google's own figure; never sum active-energy points into them. Daily rollup: workout count, active minutes, workout calories vs total calories. Discriminated union for a workout with and without HR samples. Fixtures: a paused workout (active duration less than elapsed; real example 2026-10-23 14:04, 942 s active vs 1389 s elapsed); a workout crossing local midnight; a workout with no HR; a day with zero workouts; Google returning distance as 0 for a non-distance activity.

## Task 17 — API
Status: not started
Add exercises and daily energy to `/api/v1/day` and `/days` with honest absence. A day with no workouts is measured zero only if that day has been synced, otherwise `not_synced`. Update the schema doc and the drift guard, and extend the smoke test.

## Task 18 — UI
Status: not started
An exercise page with a day view: workout list, per-workout HR curve with zone shading, calorie summary. Date navigation uses the calendar date, not the wake-up date. STOP before building and propose the layout first, following `claude_ui-design-direction.md`.
