# legacy-sync-to-chunked: STATUS

Build: move /api/sync?days=N onto the chunked civil-date sync path. Single phase.
Manager: build-manager agent. Date of opening: 2026-10-22.

## Phase 1: status DONE (GO with open items, see Decision)

### Scope guard (must not change)
- Scoring, analytics engines.
- `persist.ts` AZM upsert.
- Zone mapping.
- Lazy HR fetch behavior.
- Page render paths stay DB-only (no Google calls on render).
- No code changes at phase opening; this file only.

### Acceptance checklist (from SPEC)
- [ ] /api/sync?days=N reimplemented: civil-date range (today-N .. today), split with catch-up chunking, each chunk through syncDateRange (zones in <=7-day windows), all-or-nothing per chunk.
- [ ] Then ensureNightSamples for the most recent main session, as in the recent window.
- [ ] synced_through updated only via advanceCursor.
- [ ] last_synced_at stamped on success.
- [ ] Per-chunk results returned in the response so failures are visible.
- [ ] runGoogleSync deleted; shouldAutoSync deleted if unreferenced (grep and report).
- [ ] Duplicate 6h staleness constants merged into one.
- [ ] Gate: `npx tsc --noEmit` passes (actual output recorded).
- [ ] Gate: `npm run build` passes (actual output recorded).
- [ ] Spot-check: snapshot daily_activity_summaries for 2026-09-20..2026-10-21.
- [ ] Spot-check: run /api/sync?days=30, record response body.
- [ ] Spot-check: re-query and diff; no day's zone totals decrease.
- [ ] Spot-check: first day unchanged. SPEC says 2026-09-21 (assumed today 10-21). Today is 2026-10-22, so ?days=30 starts 2026-09-22; the check applies to 2026-09-22. Snapshot window should be widened to cover 2026-09-20..2026-10-22 so the range start and today are both included.
- [ ] Spot-check: grep confirms runGoogleSync gone (output recorded).
- [ ] Code-reviewer: no unresolved BLOCKING findings.
- [ ] git diff --stat inside phase scope.

### Planned design
- Pure `splitRange(range, chunkDays)` chunker in `src/lib/sync/catch-up.ts`; `planCatchUp` reuses it (no duplicated chunk logic).
- New orchestrator `src/lib/sync/range-sync.ts`:
  - Per-chunk lock acquire/release, so a long run never outlives the 2-min lock TTL.
  - Per-chunk `syncDateRange`.
  - Cursor advanced via `advanceCursor` only.
  - `last_synced_at` stamped only when all chunks succeed.
  - Then best-effort `ensureLatestNightSamples`.
- /api/sync?days=N: returns per-chunk results; 502 if any chunk failed, 409 if busy, 401 on auth failure.
- Delete `runGoogleSync` and `shouldAutoSync` (`loadPageData` becomes a thin passthrough).
- Remove duplicate `STALE_AFTER_HOURS` in `src/app/actions/sync.ts`, keeping `TODAY_STALE_AFTER_HOURS` (`src/lib/today/log-date.ts`).

### Pre-build grep (read-only, manager)
- `runGoogleSync`: defined and called in `src/app/actions/sync.ts` (lines ~133, ~261); mentioned in comments in `src/lib/sync/night-samples.ts`, `src/lib/sync/activity-summaries.ts`, `src/lib/sync/catch-up.ts`.
- `shouldAutoSync`: `src/app/actions/sync.ts` (~278-307) only in src. Callers outside src not yet checked; builder must grep the whole repo.
- `STALE_AFTER_HOURS`: `src/app/actions/sync.ts:39` plus `TODAY_STALE_AFTER_HOURS` in `src/lib/today/log-date.ts:33` (used by `src/lib/sync/step.ts`). The comment in log-date.ts references the old name and must be updated.

### Risks
1. Date shift: spot-check text names 2026-09-21; correct first day is 2026-09-22. Snapshot must cover the right window.
2. Lock TTL: acquire/release per chunk is required; a single lock across 3 chunks could expire mid-run and allow concurrent syncs.
3. Partial failure: cursor must not advance past a failed chunk, and `last_synced_at` must not be stamped, otherwise staleness is hidden.
4. Zone totals could decrease if the new path overwrites complete AZM with partial data; persist.ts AZM upsert is out of scope, so any such decrease means STOP and escalate, not patch.
5. Removing `shouldAutoSync` may break a client consumer (page/component) not found by the src grep; tsc and a repo-wide grep must confirm.
6. Stale comments referencing runGoogleSync in other files should be cleaned only if trivial and in scope; otherwise noted.
7. Spot-check needs the live DB (192.168.1.135) and valid Google auth; if unavailable, the phase cannot be marked done (STOP, not claim).
8. Server timezone must be Europe/Lisbon-consistent for civil-date ranges; builder should record it in the gate output.

### Gate results
Verified by manager (read-only, 2026-10-22):
- `npx tsc --noEmit`: no output, exit 0.
- `TZ=Europe/Lisbon npx tsx scripts/catch-up-check.ts`: "ALL CHECKS PASSED (TZ=Europe/Lisbon)"; splitRange case shows 2026-09-22..2026-10-05(14) | 2026-10-06..2026-10-19(14) | 2026-10-20..2026-10-22(3). Server tz is Europe/Lisbon-consistent for this run.
- `npm run build`: builder-reported passed after final edits (manager did not re-run).
- `git status --short`: modified scripts/catch-up-check.ts, src/app/actions/sync.ts, src/app/api/sync/route.ts, src/lib/sync/{activity-summaries,catch-up,night-samples,range}.ts, src/lib/today/log-date.ts; untracked docs/legacy-sync-chunked/, src/lib/sync/range-sync.ts. Also .claude/settings.local.json modified: pre-existing, NOT part of this phase, must not be committed. persist.ts, analytics, scoring untouched. `git diff --stat`: 9 files, 111 insertions, 222 deletions. All within scope (range.ts is a scope extension, see Deviations).

### Spot-check output
- grep `runGoogleSync\|shouldAutoSync\|STALE_AFTER_HOURS` over src and scripts (manager-run): only `src/lib/today/log-date.ts:33 TODAY_STALE_AFTER_HOURS = 6` and its use in `src/lib/sync/step.ts:7,36`. runGoogleSync and shouldAutoSync are gone; staleness constant merged.
- Live check (builder-reported; manager has no DB): today 2026-10-22, so ?days=30 = 2026-09-22..2026-10-22; snapshot covered 2026-09-20..2026-10-22 (28 rows). The HTTP route was NOT exercised: Chrome could not reach localhost:3000. Instead `runRangeSync(userId, 30)` was called directly from a tsx script (route is a thin wrapper: validate days, call, revalidate, map status).
- Run 1 response `sync` body: {"ok":true,"authRequired":false,"from":"2026-09-22","to":"2026-10-22","chunks":[{"from":"2026-09-22","to":"2026-10-05","days":14,"status":"ok"},{"from":"2026-10-06","to":"2026-10-19","days":14,"status":"ok"},{"from":"2026-10-20","to":"2026-10-22","days":3,"status":"ok"}],"syncedThrough":"2026-10-22"}. lock_until null afterwards, last_synced_at stamped.
- Run 1 diff vs baseline FAILED the no-decrease gate: 2026-10-06 light 184->4, moderate 3->0; 2026-10-04 light 943->1423; first day unchanged. Run 2 identical (deterministic).
- Root cause (builder probe of Google zone API, read-only): Google assigns civil dates in the DEVICE timezone, which differed from server tz by ~8h on those days, so a window starting at server-local midnight of day D loses early points of D (10-04: window from 10-04 gave 944 pts/light 943, from 10-03 gave 1424 pts/light 1423; 10-06: 4 pts vs 187 pts). The earlier catch-up chunks had this latent defect at each 7-day window start (stored 10-04 value 943 was wrong).
- Fix (range.ts only): each 7-day zone window padded 1 day each side, keeping only points whose API civilStartTime date lies in the window, so every day is in exactly one window. persist.ts AZM upsert and zone mapping untouched.
- After fix, rerun ?days=30: vs ORIGINAL baseline changed=1 (10-04 943->1423, a repair), decreased=0, 09-22 unchanged. Vs run 1: only 10-06 changed 4->184 (moderate 0->3), decreased=0. Gate now PASSES.
- Not measured: separate timing of 14-day chunks (whole run well under 2-min lock TTL, builder-reported).

### Review findings and resolutions
code-reviewer (as reported): no BLOCKING findings. Non-blocking, fixed: days capped 1..365 (400 otherwise); post-sync bookkeeping (stamp, night samples, final cursor read) wrapped so chunk results are never hidden; "earlier chunks may have been saved" wording on failure; stale range.ts header. Non-blocking, not changed: revalidate list duplicated between action and route, and /dashboard/today not revalidated by syncFromGoogle (pre-existing asymmetry); status union not exported as a named type. Note: the range.ts windowing fix was made after review; manager's check is the live diff result above, not a re-review.

### Deviations from SPEC
- First-day date 2026-09-21 -> 2026-09-22 (today is 2026-10-22, not 10-21). Reason: ?days=30 counts from today.
- Scope extension: src/lib/sync/range.ts civil-date windowing changed (padded windows + civil-date filter) because the no-decrease gate failed otherwise. Evidence above. Not an AZM upsert or zone-mapping change.
- End-to-end HTTP route not exercised (localhost unreachable from browser); runRangeSync called directly instead.

### Open questions for Gisete
a. Confirm the range.ts scope extension (windowing fix) and its evidence.
b. Only the 30-day window was re-synced; older months may still hold window-edge undercounts from earlier catch-up. A `?days=120` run would heal them (idempotent, ~N/14 chunks of Google calls). Offered, not run.
c. HTTP route / Chrome end-to-end is unverified; worth one manual hit of /api/sync?days=30 when localhost is reachable.
d. Light-minutes mapping question remains the separate AZM investigation.
e. Do not commit .claude/settings.local.json with this work.

### Decision
GO, with open items a-e above. The failed no-decrease gate was root-caused, fixed, and re-verified (decreased=0, first day unchanged); tsc and catch-up-check verified by manager, build is builder-reported.

---

## Appendix: SPEC (verbatim, as received)

Note: the manager's role restricts writes to STATUS.md, so SPEC.md was not created as a separate file. The caller should save this text to `docs/legacy-sync-chunked/SPEC.md`.

# Tina: move /api/sync?days=N onto the chunked civil-date sync path
Context: legacy runGoogleSync uses UTC-instant windows (the first day is partial and overwrites complete AZM via EXCLUDED) and fetches zones in one request subject to the 20-page cap (silently truncates for N > ~13). It's now only reachable via /api/sync?days=N.
- Reimplement /api/sync?days=N using the new path: civil-date range (today−N .. today) split with the catch-up chunking, each chunk through syncDateRange (zones in ≤7-day windows), all-or-nothing per chunk, then ensureNightSamples for the most recent main session as in the recent window. Update synced_through only via advanceCursor. Stamp last_synced_at on success.
- Return per-chunk results in the response so failures are visible.
- Delete runGoogleSync and the unused shouldAutoSync flag if nothing else references them (grep and report). Merge the duplicate 6h staleness constants into one.
- Gate: tsc, build. Spot-checks: snapshot daily_activity_summaries for 2026-09-20..2026-10-21, run /api/sync?days=30, re-query, and diff: no day's zone totals may decrease, and 2026-09-21 (the first day) must be unchanged. Report the response body. grep confirms runGoogleSync is gone.
