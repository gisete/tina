# Catch-up sync: STATUS

Source of truth: docs/catch-up-sync/SPEC.md. Workflow: PM opens/signs off each phase, code-reviewer reviews each phase diff, max two fix rounds, one commit per phase.

## Phase 0: read-only investigation

Status: DONE (opened and signed off in one pass). Decision: GO to Phase 1.

### The five items
1. AZM integrity (HARD GATE): confirm persist.ts AZM upsert always overwrites and steps upsert touches only steps; if anything preserves AZM, STOP. No sync run.
2. Sync window computation, 6h staleness guard, auto-sync trigger location, sync_state schema.
3. How Google auth failures (e.g. invalid_grant) surface to the sync code.
4. Google requests per synced day / per 14-day chunk; existing rate limiting/backoff.
5. Current sync_state row, and contiguous ranges/gaps in sleep_sessions and daily_activity_summaries since 2026-07-01.

### Hard gate: PASS (independently verified by PM)
- src/lib/sync/persist.ts persistActivitySummaries: conflict set is light/moderate/vigorous/peak = `EXCLUDED.<col>`, updatedAt = NOW(). No COALESCE (COALESCE appears only in the heart-summary upsert).
- persistDailySteps: conflict set is `steps = EXCLUDED.steps` and `updatedAt` only.

### No-code-change check (PM ran)
- `git diff --stat HEAD -- src/lib src/app/actions`: only stage-colors.ts, format.ts, sync/read.ts (all in the pre-existing unrelated list).
- `git status --short`: only the pre-existing unrelated files plus new `docs/catch-up-sync/`. src/db/schema.ts diff (+19) contains no sync_state / synced_through / lock_until changes (grep empty), so it is the unrelated pre-existing edit.
- Conclusion: Phase 0 changed no code or schema. Gate commands (tsc/build) N/A.

### Findings (builder's, with PM verification)
F1 AZM integrity: as above. persist.ts last changed by c322cbb (Today Phase 1, added persistDailySteps). Gate passes.

F2 Sync window / staleness / trigger / schema:
- src/app/actions/sync.ts runGoogleSync({days = RECONCILE_WINDOW_DAYS = 3}): startDate = new Date() minus days; startISO/endISO via toISOString() (UTC instants). Steps window uses civil dates addDays(localToday(), -days) .. tomorrow (exclusive).
- Staleness: STALE_AFTER_HOURS = 6 in sync.ts loadPageData (shouldAutoSync only when target date is today and last_synced_at missing or > 6h old). Duplicate constant TODAY_STALE_AFTER_HOURS = 6 + isSyncStale in src/lib/today/log-date.ts.
- Trigger: client component src/app/dashboard/components/auto-sync.tsx (useTransition -> syncFromGoogle() -> router.refresh(), swallows errors), rendered per page by dashboard/page.tsx, sleep/page.tsx, heart/page.tsx, sleep/heart-rate/page.tsx, today/page.tsx. PM verified via `grep -rln AutoSync src`: exactly these 5 pages (plus the component and a sync.ts comment).
- syncFromGoogle = runGoogleSync + revalidatePath(/dashboard, /dashboard/sleep, /dashboard/heart). /api/sync?days=N calls syncFromGoogle({days}) then readDashboardData.
- sync_state: user_id uuid PK (FK users, cascade), last_synced_at timestamp NOT NULL, nothing else. runGoogleSync stamps last_synced_at = NOW() at the end.
- PM verified: RECONCILE_WINDOW_DAYS = 3 (line 33), STALE_AFTER_HOURS = 6 (line 39), Promise.allSettled at line 214.
- [DESIGN IMPACT] runGoogleSync ends with ensureNightSamples(userId, mainSession) (sync.ts line 301; PM verified), a Google HR-sample fetch, before stamping the sync clock. Catch-up must NOT do this. Phase 2 must extract/parameterise the sync core without that call. The lazy HR fetch itself stays untouched.
- [DESIGN IMPACT] Failure semantics today: sleep fetch rejection throws; heart, zone and steps rejections only console.warn, the sync continues and still stamps last_synced_at. A catch-up chunk may advance the cursor only if ALL fetches succeeded.

F3 Auth failures (PM verified in src/lib/google/client.ts): no typed error. Plain Errors: refresh failure `Token refresh failed: ${JSON.stringify(tokens)}` (line 27; body contains invalid_grant), "User does not have a linked Google Account session." (54), "No refresh token available." (125, 277), `Google Health API error [type]: status - body` (132, 282). auth() missing session throws "Unauthorized". Phase 2 must classify by message/body or add a small typed GoogleAuthError in client.ts auth paths; either is outside the scope guard, so allowed.

F4 Requests / rate limiting:
- No rate limiting or backoff in the sync path (only 200ms PACE_MS in scripts/backfill-activity-zones.ts; only retry is the single 401 token refresh).
- Per sync unit: sleep 1+ calls (pageSize 25), heart 2 parallel calls, zones time-in-heart-rate-zone pageSize 1000 (about 1440 points per fully worn day; stored light_minutes 1385/1427 on recent days), steps dailyRollUp 1 call per 30-day chunk.
- PM verified: MAX_PAGES = 20 (client.ts line 84) and the loop (line 117) exits at the cap with no error and no log of truncation (only breaks on missing nextPageToken).
- [DESIGN IMPACT] A fully worn 14-day chunk is about 20,160 zone points (about 21 pages) > 20,000 cap, so the newest ~160 minutes of zone data would be silently dropped (last day's AZM understated) while the chunk looks successful. About 25-27 Google calls per 14-day chunk, zones dominating. Phase 2 must fetch zones in sub-windows (<= 7 days, about 10 pages) or make truncation detectable. Does not touch AZM zone mapping.
- Window bounds today are UTC instants from `new Date()`, not local-midnight civil boundaries. Chunk bounds must come from civil dates (pre-existing quirk, not to be fixed outside the new path).

F5 Data (BUILDER-REPORTED, live DB read-only; PM has no DB access and did not verify). User 622a1594-a34e-41f8-95fa-5c2caeb5a018.
- sync_state: last_synced_at = 2026-10-21 20:24:35 (UTC-stored).
- sleep_sessions: 77 rows overall, sleep_date 2026-04-27..2026-10-20. Since 07-01: 07-01..07-02 (2 days) | 07-10..07-17 (8) | 10-18..10-20 (3). Gaps: 07-03..07-09, 07-18..10-17.
- daily_activity_summaries: 07-01..07-03 (3) | 07-10..07-18 (9) | 10-14..10-21 (8). Gaps: 07-04..07-09, 07-19..10-13.
- heart_rate_summaries: 07-01..07-03 | 07-10..07-18 | 10-18..10-21.
- IMPORTANT: activity rows 10-14..10-17 are steps-only rows from Today Phase 1's spot-check (AZM columns default 0; no sleep/heart for those days). They mask the real gap and must not count as coverage.
- Proposed derivation rule (to settle in Phase 1, see Q1): a day is covered if it has a sleep session (by sleep_date), a heart summary, or an activity row with non-zero zone minutes. Walking back from today: 10-21..10-18 covered, 10-17 first missing, gap continues to 07-19, 07-18 covered => synced_through = 2026-07-18 (matches SPEC). Activity-row presence alone would wrongly give 2026-10-13 or later, which the SPEC says to STOP on. Earlier gaps (07-03..07-09) are ignored (only the most recent gap matters).

### Deviations
- D1: project-manager/code-reviewer agents are not registered; run as general-purpose following .claude/agents/*.md.
- D2: Phase 0 has no gate commands (no code changed), so tsc/build N/A. No code-reviewer pass needed (no diff).
- Note: .claude/agents/project-manager.md still names the Today build/STATUS path; applied here to the catch-up build per instruction.

### Open questions for Gisete
- Q1: Confirm the coverage-derivation rule (sleep session OR heart summary OR non-zero-AZM activity row), so steps-only rows do not count as coverage. Expected result 2026-07-18.
- Q2: Zone fetches get sub-windowed (<= 7 days) in Phase 2 because of the silent 20-page cap. Acceptable?
- Q3: A chunk advances the cursor only if all four fetches (sleep, heart, zones, steps) succeed. This differs from today's warn-and-continue behavior (kept for the legacy path). Acceptable?
- Q4: Server timezone vs Europe/Lisbon was not checked in Phase 0 (the SPEC's Phase 0 does not list it). Per PM rules, confirm before Phase 3/any date-sensitive step if relevant.

### Decision: GO to Phase 1

## Next phase criteria: Phase 1 (Schema + pure planner)

Acceptance criteria (from SPEC):
- sync_state gains `synced_through` (local "YYYY-MM-DD", nullable) and `lock_until` (timestamp, nullable); additive, applied with `npx drizzle-kit push` (never migrate).
- My existing row's synced_through initialised from actual data (not last_synced_at): the last date before the first missing day, walking back from today in daily_activity_summaries and sleep_sessions. Report the derived value. Expected 2026-07-18. If later than 2026-10-13, STOP and report.
- Pure engine `src/lib/sync/catch-up.ts`: inputs syncedThrough (string | null), today, constants RECENT_WINDOW_DAYS = 3, CHUNK_DAYS = 14. Returns a plan: recent window first, then gap chunks oldest->newest covering (syncedThrough+1 .. today-RECENT_WINDOW_DAYS). Null syncedThrough keeps existing default behavior (state what that is: a single 3-day reconcile window). Also export pure `advanceCursor(syncedThrough, chunkFrom, chunkTo)` implementing the Phase 2 cursor rule (advance to `to` only if from <= synced_through + 1). Explicit return types; date math only via src/lib/dates.ts; no React/Next/DB imports.
- Layering per AGENTS.md; tsc --noEmit and npm run build pass; scope guard respected (no scoring/analytics/lazy-HR/AZM-mapping changes).

Spot-checks (npx tsx fixtures, real output must be recorded):
- Gap 0 days.
- Gap 2 days (recent window only, no gap chunks).
- Gap 95 days: expected chunk count and exact boundary dates, no overlaps, no holes.
- A gap crossing the end-of-October DST change.
- advanceCursor with synced_through = 2026-07-18 and successful recent window 2026-10-18..2026-10-21 leaves it at 2026-07-18.
- advanceCursor with contiguous chunk 2026-07-19..2026-08-01 moves it to 2026-08-01.
- Plus: the derived synced_through for the real row reported.

Phase 1 sign-off will additionally require: actual tsc/build output, real spot-check output, no unresolved BLOCKING review findings, git diff --stat limited to schema.ts (sync_state only), src/lib/sync/catch-up.ts, and any init script (excluding the pre-existing unrelated files).

## Phase 1: schema + pure planner

Status: DONE. Decision: GO to Phase 2.

### PM-verified (read-only, this session)
- `git diff --cached --stat`: exactly 5 files, 317 insertions: scripts/catch-up-check.ts (142), scripts/init-synced-through.ts (52), src/db/schema.ts (+8), src/lib/dates.ts (+11), src/lib/sync/catch-up.ts (104). Nothing else staged.
- `git diff --cached src/db/schema.ts`: single hunk in sync_state: `syncedThrough: date("synced_through")` and `lockUntil: timestamp("lock_until")`, both nullable, additive. The unrelated pre-existing unstaged schema.ts edit is not staged.
- Untouched: no staged or modified files under src/lib/scoring, src/lib/analytics (only an untracked pre-existing feeling-tags.ts, unrelated), src/app/actions/sync.ts, src/lib/google/. Scope guard respected.
- Re-ran `TZ=Europe/Lisbon npx tsx scripts/catch-up-check.ts`: "ALL CHECKS PASSED (TZ=Europe/Lisbon)"; advanceCursor outputs: gap-before-recent = 2026-07-18, contiguous chunk = 2026-08-01, after fill = 2026-10-21; deriveSyncedThrough (live-shaped) = 2026-07-18; null cursor = recent only, stays null.
- Re-ran `npx tsc --noEmit`: clean (exit 0).

### Builder-reported (not PM-verified; PM has no DB access)
- `npx drizzle-kit push`: "[✓] Changes applied", no data-loss/rename/drop prompt. Adds sync_state.synced_through (date, nullable) and lock_until (timestamp, nullable).
- Init script dry-run: user 622a1594-...: today=2026-10-21 covered_days=117 last_synced_at=2026-10-21 20:24:35 current_synced_through=null derived=2026-07-18. `--write`: "wrote synced_through=2026-07-18". Equals SPEC expectation; not later than 2026-10-13, so the STOP rule is not triggered. Coverage rule (Q1 as proposed): sleep_sessions.sleep_date, heart_rate_summaries.date, or activity row with non-zero zone minutes; steps-only default-0 rows excluded.
- `npm run build` succeeded; staged-tree tsc (checkout-index to temp tree) OK after last edit.
- Fixtures ALL PASSED under Europe/Lisbon, America/Los_Angeles, Pacific/Auckland, UTC: gap 0 -> recent 2026-10-18..2026-10-21 (4 days), 0 chunks; gap 2 -> 0 chunks (syncedThrough=today-4 also 0; today-5 -> one chunk 10-17..10-17); gap 95 (synced 2026-07-14) -> 7 chunks 07-15..07-28, 07-29..08-11, 08-12..08-25, 08-26..09-08, 09-09..09-22, 09-23..10-06, 10-07..10-17 (11 days), total 95, no overlap, no hole; DST: synced 2026-10-20, today 2026-11-12 -> 10-21..11-03 (14) | 11-04..11-08 (5), tiling checks across NZ/EU/US DST dates.
- Review (general-purpose stand-in): BLOCKING none. Non-blocking: chunkDays<=0 infinite loop FIXED (Math.max(1, chunkDays), gates re-run); other items carried to Phase 2 below. Fix rounds used: 0 of 2.

### Deviations
- D1: agents unregistered; run as general-purpose per .claude/agents/*.md (as in Phase 0).
- D2: SPEC says gap chunks cover syncedThrough+1 .. today-RECENT_WINDOW_DAYS; builder ends the gap at recent.from-1 = today-4, because the recent window is today-3..today (4 civil days, same as runGoogleSync always fetched). Chunks never overlap the recent window; consistent with the cursor rule. PM accepts (SPEC's literal text would double-fetch today-3).
- D3: scripts/init-synced-through.ts committed as a reproducible one-off; never overwrites a non-null value; DB row written via --write.
- Addition outside SPEC list: diffDays() in src/lib/dates.ts (UTC-component arithmetic, DST-proof); no day-difference helper existed. Accepted.
- Null syncedThrough behavior (stated): a single recent window only (the existing 3-day reconcile behavior), no gap chunks.

### Decision: GO to Phase 2

## Next phase criteria: Phase 2 (Sync-step endpoint)

Acceptance criteria (from SPEC):
- One endpoint (follow repo conventions for route vs action) performing ONE unit of work per call: acquire lock (TTL about 2 min; held and unexpired -> busy) -> next unit (recent window if stale per the existing 6h rule, else the next gap chunk) -> persist via existing sync persist code -> update synced_through via advanceCursor only after the chunk fully succeeds -> release lock -> return union: { kind: 'idle' } | { kind: 'running', from, to, daysDone, daysTotal } | { kind: 'busy' } | { kind: 'auth_required' } | { kind: 'error', message }.
- Cursor rule: advances contiguously; chunk [from,to] sets synced_through = to only if from <= synced_through + 1. Recent window must not advance it while a gap exists before it; once the gap is filled the recent window advances it to today.
- Auth failure (expired/revoked refresh token) returns auth_required, never generic error.
- last_synced_at keeps its meaning and still drives the 6h staleness rule.
- Existing manual Sync button and /api/sync?days=N keep working; the Sync button uses the same step logic.
- Scope guard: no scoring/analytics/lazy-HR/AZM-mapping changes. Layering: orchestration only in the action/route; pure logic in src/lib; DB writes in persist.ts. tsc and build pass.

Carry-forward (must be satisfied; PM will check each):
- From Phase 0: (i) catch-up path must NOT call ensureNightSamples; extract/parameterise the runGoogleSync core without it (legacy path unchanged). (ii) A chunk advances the cursor only if ALL fetches (sleep, heart, zones, steps) succeed; no warn-and-continue in the catch-up path. (iii) Fetch zones in sub-windows of <= 7 days (fetchHealthDataType silently caps at MAX_PAGES=20). (iv) Chunk bounds from civil dates (local midnight), not `new Date()` UTC instants. (v) Classify auth failures (invalid_grant in the refresh body, "No refresh token available.", linked-session errors, "Unauthorized") as auth_required via a typed error in client.ts or message inspection. (vi) Existing 6h staleness rule drives the recent window. (vii) Steps-only rows 2026-10-14..10-17 must end with real AZM after catch-up.
- From Phase 1 review: (viii) only pass chunk ends <= today to advanceCursor (it can move the cursor into the future otherwise). (ix) null synced_through means "gap tracking off"; never set it from null in app code (only the init script does); null -> recent window only, cursor untouched. (x) lock_until must be released on every exit path, including errors and auth failures (try/finally), and acquisition must be atomic (single conditional UPDATE/upsert), so concurrent calls cannot both win.
- Q2/Q3 from Phase 0 (sub-windowed zones; all-fetches-must-succeed) are treated as accepted since the SPEC and builder instruction already demand them; Gisete may object at any time.

Spot-checks (real output must be recorded; DB results builder-reported, PM has no DB access):
1. Call the endpoint repeatedly against the real DB until idle; report every response (kind, from, to, daysDone/daysTotal).
2. SELECT counts of sleep_sessions and daily_activity_summaries per month for Jul-Oct, and the sync_state row (synced_through should equal today).
3. Concurrency: two simultaneous calls; one must return busy.
4. Re-query daily_activity_summaries for 2026-10-14..10-17: previously default-0 AZM, must now hold API values. Report as-is (light-minutes mapping is a known open question; do not fix).
5. Auth path: demonstrate (by unit fixture or forced error) that invalid_grant and "No refresh token available." map to auth_required.
6. Regression: /api/sync?days=3 and the Sync button still work; legacy path still calls ensureNightSamples, catch-up path does not (grep evidence).
7. AZM integrity re-check: persist.ts upserts unchanged (git diff on persist.ts shows no change to conflict sets).
8. Lock released after an induced failure (lock_until null or past after the call).

Phase 2 sign-off requires: tsc/build output, spot-check outputs above, no unresolved BLOCKING review findings, git diff --stat limited to the sync action/route, catch-up/sync lib files, optional client.ts typed error, and sync_state-related files (excluding pre-existing unrelated files), max two fix rounds.

## Phase 2: sync-step endpoint

Status: DONE. Decision: GO to Phase 3.

### PM-verified (read-only, this session)
- `git diff --cached --stat`: exactly 12 files, 439 insertions / 8 deletions, all in scope: scripts/catch-up-check.ts, src/app/actions/sync.ts, src/app/api/sync/step/route.ts, src/app/dashboard/components/sync-button.tsx, src/lib/google/{client,errors}.ts, src/lib/sync/{catch-up,step-types,activity-summaries,sync-state,range,step}.ts.
- `git diff --cached --name-only | grep persist`: empty. `git diff HEAD --stat -- src/lib/sync/persist.ts src/lib/analytics src/lib/scoring`: empty. AZM upsert conflict sets unchanged (spot-check 7 PASS); scope guard respected.
- `grep -rn ensureNightSamples src/lib/sync src/app/api`: no matches (carry-forward (i) PASS; legacy runGoogleSync in src/app/actions/sync.ts still calls it, unchanged).
- `grep` for react/next/db/drizzle/pg imports in catch-up.ts, step-types.ts, activity-summaries.ts: none (pure).
- Re-ran `TZ=Europe/Lisbon npx tsx scripts/catch-up-check.ts`: ALL CHECKS PASSED; simulated loop recent, 7 gap chunks, closing recent, cursor ends 2026-10-21.
- Re-ran `npx tsc --noEmit`: clean (exit 0).

### Builder-reported (PM has no DB/Google access; not PM-verified)
- Gate: `npm run build` compiled with `ƒ /api/sync/step`; staged-tree tsc OK after final review fixes.
- Design: POST /api/sync/step; runSyncStep = acquireSyncLock (single conditional UPDATE, DB NOW()+2min) -> readSyncState -> planCatchUp -> pickNextUnit -> syncDateRange (allSettled sleep/heart/zones in <=7-day windows/steps; any rejection throws, auth errors preferred) -> existing persist functions -> last_synced_at only for recent units -> advanceCursor only after success -> lock released in finally. Typed GoogleAuthError -> auth_required. syncFromGoogle() with no `days` runs one forced recent step; with `days` the legacy runGoogleSync (/api/sync?days=N) is unchanged.
- SC1 live loop: gap 07-19..08-01 14/91, 08-02..08-15 28/91, 08-16..08-29 42/91, 08-30..09-12 56/91, 09-13..09-26 70/91, 09-27..10-10 84/91, 10-11..10-17 91/91, recent 10-18..10-21 91/91, idle. Chunks 2.5-17s each.
- SC2: sleep_sessions per month 07:24 08:33 09:30 10:16; activity rows 07:25 08:31 09:30 10:17 (with zones 25/31/30/16); sync_state synced_through 2026-10-21, lock_until null.
- SC3: two parallel forced POSTs -> running(recent) and busy. SC4: 10-14..10-17 now hold real AZM (e.g. 10-17 light 632 moderate 37; 10-16 zero-zone genuinely, steps 9421); 10-18 light 57 -> 1269 (new whole-local-day window). Light-minutes mapping remains the known open question. SC5: invalid_grant, no linked account -> auth_required (offline, stubbed fetch); "No refresh token" sites by static inspection only. SC6/8: induced 500s -> kind=error, lock released, cursor and clock unchanged, no data written; parallel acquire {true,false}. SC7: no HR samples written by catch-up.
- Review (stand-in): BLOCKING none; fix rounds used 0 of 2. Fixed: release failure no longer replaces result, SyncButton try/catch, explicit POST return type, window comment.

### Carry-forwards (i)-(x)
(i) PASS grep. (ii) PASS (allSettled, any rejection throws; induced failure). (iii) PASS (<=7-day zone windows). (iv) PASS (civil-date windows, range.ts). (v) PASS (typed GoogleAuthError; 403 intentionally not mapped). (vi) PASS (6h rule via last_synced_at). (vii) PASS (builder-reported SC4). (viii) PASS by fixture loop (cursor ends today). (ix) PASS by design (null -> recent only). (x) PASS (finally release, atomic UPDATE, builder-reported SC3/SC8).

### Deviations
- D1: agents unregistered (as before). D2: gap ends today-4 (accepted Phase 1). D4: additive `unit` field on 'running' in the wire union. D5: recent window does not call ensureNightSamples (SPEC), so Today's last-night score may show the 'partial' indicator until the sleep page is opened (it lazily fetches). D6: syncFromGoogle() (Sync button/AutoSync) is now all-or-nothing and no longer calls ensureNightSamples; /api/sync?days=N is the unchanged legacy path (stamps last_synced_at, does not move synced_through). D7: sync-button.tsx got a try/catch.
- Note: a third forced sync was triggered accidentally during the concurrency test (harmless idempotent recent-window run).

### Open questions for Gisete
- Q5 (from D5): accept that Today's last-night HR-sample score may show 'partial' until the sleep page is opened, or schedule a follow-up that fetches night samples outside catch-up?
- Q6: 403 from Google is left as a generic error (scope issue), not auth_required. Acceptable?
- Q7: Lock steal after 2-min TTL is possible only if a step outlives it (chunks take <=17s); release is not token-based. Acceptable?
- Q4 (server tz): Phase 0 verified server tz Europe/Lisbon per builder; zone windows rely on server tz = user tz.

### Decision: GO to Phase 3

## Next phase criteria: Phase 3 (UI)

Acceptance criteria (from SPEC):
- One layout-level client component in src/app/dashboard/layout.tsx replaces the five per-page AutoSync triggers (dashboard/page.tsx, sleep/page.tsx, heart/page.tsx, sleep/heart-rate/page.tsx, today/page.tsx). On mount it POSTs /api/sync/step in a loop while the result is 'running', then router.refresh() once on 'idle' only.
- Banner (token classes, tw-animate-css enter): "Catching up: <from> -> <to>, X of Y days" with a progress bar. Nothing shown for a plain recent-window sync finishing under ~2s; small inline "Syncing..." otherwise.
- auth_required (also an HTTP 401 from the route) -> banner with "Reconnect Google" button using the existing sign-in flow; stop looping.
- error -> banner with Retry; stop looping; never auto-retry in a tight loop. busy -> poll every few seconds, at most ~1 minute, then stop with a message.
- Banner state/text logic in a pure src/lib module (plain data in, JSON-safe out, explicit return types) with tsx fixtures; component only renders. Dates formatted via src/lib/format.ts (add a helper there if needed; no inline toLocale*).
- The manual SyncButton keeps working (and does not fight the layout loop).
- Scope guard: no changes to src/lib/sync/persist.ts, scoring, analytics, step.ts semantics. AGENTS.md conventions (no any, token classes, layering). tsc and build pass.

Carry-forward (PM will check each):
- (a) Client sends force:true only on the FIRST call, or never; otherwise the loop runs the recent window forever.
- (b) previousTotal is echoed from the prior running response on each subsequent call.
- (c) Loop stops on every terminal kind (idle, auth_required, error), on unmount (abort/cancel flag, no setState after unmount, no double loop under React strict-mode double effect), and busy polling is bounded.
- (d) router.refresh() exactly once, on idle, and not on error/auth/busy timeout.
- (e) Exactly one trigger remains: grep for AutoSync/old trigger in the five pages is empty; the old auto-sync.tsx is removed or unused.
- (f) Reconnect Google reuses the existing sign-in flow (no new auth code).
- (g) Staleness is decided server-side by the step route (6h rule); the layout component must not add a second client staleness rule that suppresses catch-up when synced_through lags.

Spot-checks (record real output):
1. Pure-module fixtures via `npx tsx`: running (with/without previousTotal), idle, busy (with elapsed), auth_required, error, quick recent window hidden vs slow "Syncing...", progress percent bounds (0-100, daysTotal 0).
2. grep evidence for (e) and for a single layout-level mount in src/app/dashboard/layout.tsx.
3. Chrome (if the extension is connected): set sync_state.synced_through back 30 days (record original value first), open /dashboard/today, screenshot the banner mid-progress and after completion, then RESTORE synced_through and confirm lock_until null. If Chrome is unavailable, state so and mark unverified.
4. Failure UI: simulate error and auth_required (e.g. stubbed route response in the browser) and screenshot the Retry and Reconnect banners; no tight retry loop (network log shows no repeated calls).
5. Manual SyncButton click still works (builder-reported).
6. tsc --noEmit and npm run build pass.

Phase 3 sign-off requires: tsc/build output, spot-check outputs, no unresolved BLOCKING review findings (max two fix rounds), git diff --stat limited to src/app/dashboard/layout.tsx, the new client component, the pure src/lib module (plus fixtures script), format.ts helper if needed, and removal/edits of the five page triggers (excluding pre-existing unrelated files; note several of those pages, e.g. sleep/page.tsx, already carry unrelated unstaged edits, so the builder must stage only its own hunks).
