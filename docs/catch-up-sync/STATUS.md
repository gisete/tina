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
