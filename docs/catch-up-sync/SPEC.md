# Tina: automatic catch-up sync

Read AGENTS.md first. Save this prompt to docs/catch-up-sync/SPEC.md and use the same per-phase workflow as the Today build (project-manager opens and signs off each phase; code-reviewer reviews each phase's diff; max two fix rounds; one commit per phase). Final message is docs/catch-up-sync/STATUS.md.

Goal: when I open the app after any gap, it automatically syncs everything missing up to today, showing progress in the UI. No manual /api/sync?days=N needed.

Scope guard: no changes to scoring, analytics engines, the lazy HR-sample fetch, or the AZM zone mapping (a separate investigation will handle that). Catch-up never fetches intra-night HR samples. Page render paths stay DB-only; Google calls happen only in the sync-step endpoint.

## Phase 0 — Read-only investigation (no code or DB changes)
1. AZM integrity (HARD GATE, re-confirm): a previous investigation found the AZM upsert in src/lib/sync/persist.ts sets each AZM column to EXCLUDED.<col> (always overwrites) and the steps upsert touches only steps. Confirm this is still true. If anything now preserves existing AZM values, STOP the entire build and report. Do not run any sync.
2. How the current sync window is computed, the 6-hour staleness guard, where the auto-sync trigger lives, and the current sync_state schema.
3. How Google auth failures surface today (e.g. invalid_grant on token refresh): what error type reaches the sync code?
4. Requests per synced day (how many Google calls a 14-day chunk makes) and any existing rate limiting/backoff.
5. Current sync_state row for my user, plus the date ranges actually present in sleep_sessions and daily_activity_summaries since 2026-07-01 (list contiguous ranges and gaps).

## Phase 1 — Schema + pure planner
- Add to sync_state (additive, drizzle-kit push): `synced_through` (local "YYYY-MM-DD", nullable) = latest date with contiguous coverage; `lock_until` (timestamp, nullable).
- Initialize my existing row's synced_through from actual data, NOT from last_synced_at (a recent 3-day sync bumps that timestamp without covering older gaps). Set it to the last date before the first missing day, found by walking back from today in daily_activity_summaries and sleep_sessions. Report the value you derive. Expected: 2026-07-18. If you derive anything later than 2026-10-13, STOP and report.
- Pure engine `src/lib/sync/catch-up.ts`: given syncedThrough (string | null), today, and constants RECENT_WINDOW_DAYS = 3 and CHUNK_DAYS = 14 → returns a plan: the recent window first, then gap chunks oldest→newest covering (syncedThrough+1 .. today−RECENT_WINDOW_DAYS). Null syncedThrough → keep existing default behavior (state what that is). Also export a pure `advanceCursor(syncedThrough, chunkFrom, chunkTo)` implementing the cursor rule in Phase 2. Explicit return types; date math via src/lib/dates.ts only.
- Gate fixtures (npx tsx): gap 0 days; gap 2 days (recent window only, no gap chunks); gap 95 days (expected chunk count and exact boundary dates, no overlaps, no holes); a gap crossing the end-of-October DST change; advanceCursor with synced_through = 2026-07-18 and a successful recent window 2026-10-18..2026-10-21 leaves synced_through at 2026-07-18; advanceCursor with a contiguous chunk 2026-07-19..2026-08-01 moves it to 2026-08-01.

## Phase 2 — Sync-step endpoint
- One endpoint (follow repo conventions for route vs action) that performs ONE unit of work per call: acquire lock (TTL ~2 min; if held and unexpired, return busy) → run the next unit (recent window if stale per the existing 6h rule, else the next gap chunk) → persist via existing sync persist code → update synced_through via advanceCursor only after the chunk fully succeeds → release lock → return a discriminated union:
  { kind: 'idle' } | { kind: 'running', from, to, daysDone, daysTotal } | { kind: 'busy' } | { kind: 'auth_required' } | { kind: 'error', message }
- Cursor rule: synced_through only advances contiguously. A successful chunk covering [from, to] sets synced_through = to only if from <= synced_through + 1. The recent-window sync must not advance synced_through while a gap exists before it. Once the gap is fully filled, the recent window advances it to today.
- An auth failure (expired/revoked refresh token) returns auth_required, never a generic error.
- last_synced_at keeps its current meaning (when the last sync ran) and still drives the 6h staleness rule.
- The existing manual Sync button and /api/sync?days=N keep working; the Sync button now uses this same step logic.
- Gate spot-checks: call the endpoint repeatedly against my real DB until idle; report each response. Then SELECT counts of sleep_sessions and daily_activity_summaries rows per month for Jul–Oct, and the sync_state row (synced_through should now equal today). Call it concurrently twice: one must return busy. Re-query daily_activity_summaries for 2026-10-14..2026-10-17: these previously held default-0 AZM from a steps-only write and must now hold values from the API. Report them as-is (the light-minutes mapping is a known open question; don't fix it).

## Phase 3 — UI
- Replace the existing per-page stale-view trigger with one layout-level client component covering all dashboard pages. On mount it calls the step endpoint in a loop while it returns 'running', then router.refresh() once on 'idle'.
- Banner (token classes, tw-animate-css enter) shows "Catching up: <from> → <to>, X of Y days" with a progress bar. Show nothing for a plain recent-window sync that finishes quickly (under ~2s); show a small inline "Syncing…" otherwise.
- auth_required → banner with a "Reconnect Google" button that starts the existing sign-in flow; stop looping.
- error → banner with Retry; stop looping (never retry automatically in a tight loop). busy → poll every few seconds, at most ~1 minute.
- Logic for banner state/text lives in a pure src/lib module; the component only renders it. Dates are formatted via src/lib/format.ts.
- If the Chrome extension is connected, click through: open /dashboard/today with synced_through set back 30 days (restore it afterwards), and screenshot the banner mid-progress and after completion.
