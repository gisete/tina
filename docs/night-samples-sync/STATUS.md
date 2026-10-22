# night-samples-sync: STATUS

Single phase. Status: DONE with gaps (GO; see Sign-off at the bottom).

## Scope guard
- Recent-window unit only. Gap chunks never fetch HR samples.
- Read paths' behavior unchanged (lazy ensureNightSamples in readDashboardData stays as fallback).
- A sample-fetch failure never fails the unit, blocks the cursor, or stamps an error: log a warning and continue.
- Only files in scope: new src/lib/sync/night-samples.ts, src/app/actions/sync.ts (import only, remove private copy), src/lib/sync/step.ts, this STATUS.md.

## Acceptance criteria
- [ ] Grep: ensureNightSamples called only from the recent-window branch in step.ts, the legacy runGoogleSync path, and the lazy read fetch in sync.ts (actual output recorded)
- [ ] `npx tsc --noEmit` passes (output recorded)
- [ ] `npm run build` passes (output recorded)
- [ ] Forced recent step on the real DB: heart_rate_samples row count for last night (session start..end) recorded before and after
- [ ] Today's last-night card no longer shows "partial" (Chrome click-through if connected; otherwise state that it was not verified)
- [ ] Builder shows which legacy code was mirrored (sync.ts lines ~294-303: findMany sleepSessions by sleepDate desc limit 5, selectMainSessions(...)[0])

## Planned design
- Extract ensureNightSamples (currently private in src/app/actions/sync.ts, ~line 69) plus the main-session selection (desc sleepDate, limit 5, selectMainSessions()[0]) into a new non-"use server" file src/lib/sync/night-samples.ts. Exporting from a "use server" file would expose it as a callable action taking an arbitrary userId.
- sync.ts and step.ts both import it; sync.ts behavior unchanged (keep the doc comment about the deliberate read/sync exception with the function).
- step.ts calls it after the cursor and clock writes, in try/catch, only when unit.kind === "recent".

## Risks
- The call runs inside the sync lock (2-minute TTL); a slow Google fetch delays lock release and the step response. Mitigation: after cursor/clock writes, bounded by the existing lock TTL.
- ensureNightSamples' cache query sits outside its inner try, so a DB error can throw; the step.ts try/catch must cover it, and the catch must not return an error result.
- The outer catch in runSyncStep maps throws to an error result, so the new call must be wrapped separately, not left to it.
- GoogleAuthError from the sample fetch is swallowed by the inner catch; acceptable per spec, but the builder should confirm auth problems still surface via the range sync.
- Moving the function must carry its imports (MIN_NIGHT_SAMPLES, normalize/persist/fetch helpers) without creating a cycle with sync.ts.
- Real-DB spot-check writes data and hits Google; if last night already has samples >= MIN_NIGHT_SAMPLES, before/after will be equal and not prove the change (needs a night with sparse cache, or document that).

## Sign-off (2026-10-22)

Status: DONE with gaps. Decision: GO (conditional on open items below).

### Verified by me (read-only)
- Grep `ensureNightSamples|ensureLatestNightSamples` in src: sync.ts:19 import; sync.ts:94 lazy read fetch (ensureNightSamples); sync.ts:228 legacy runGoogleSync (ensureLatestNightSamples); step.ts:9 import and step.ts:53 recent-window branch only (`if (unit.kind === "recent")`); definitions at night-samples.ts:36 and :80 (80 calls 36 at :88); today/read.ts:137 is a comment only. No call in gap chunks. PASS.
- `npx tsc --noEmit`: no output, exit 0. PASS.
- step.ts code read: call sits after syncDateRange, stampSyncedNow, writeSyncedThrough; wrapped in `.catch` that only console.warns, so a failure cannot return an error result, block the cursor or stamp an error. Matches spec.
- `git status --short`: sync.ts, step.ts, new night-samples.ts, docs/night-samples-sync, plus `.claude/settings.local.json` (modified; already dirty at session start, not part of this build, not touched by it; do not commit with this work). persist.ts, analytics, scoring untouched. diff --stat: sync.ts 85 lines (mostly removal of private copy), step.ts 12.

### Builder-reported (not independently re-run by me)
- `npm run build` passed.
- Forced one recent step on the real DB via runSyncStep(force): {kind:running, unit:recent, 10-19..10-22}, sync log lines, no errors.
- Code-reviewer: no blocking findings. Non-blocking: log prefix `[sync]` vs `[sync-step]` (inconsistency, left); step.ts header comment updated (done).

### Accepted risk
- The sample fetch runs inside the 2-minute sync lock, so a slow Google fetch delays the step response and lock release. Bounded by the lock TTL; accepted.

### HONEST GAPS (open items for Gisete)
1. Fetch not demonstrated. The newest main session is still the 2026-10-20 night (start 10-20T22:01Z, end 10-21T06:09Z); it already had 11270 samples before and after, and 0 samples exist after its end, so ensureNightSamples returned early on the warm cache. Count 11270 -> 11270 does NOT show a fetch firing (no newer night exists yet; today is 10-22). Wiring is verified by code reading and grep only.
2. Chrome click-through of Today's card failed: tab timed out (get_page_text "Page still loading" x3) although dev server logged GET /dashboard/today 200. "No longer partial" is UNVERIFIED live. Reasoning only: partial is driven by sparse samples for the last night, and that night has 11270.
3. The card's state before the change (whether it was partial) was never observed, so no before/after comparison exists.

Suggested follow-up: after the next night syncs (a new session appears), confirm the first recent step fetches its samples (row count rises from ~0) and that Today's card is not partial; retry the Chrome check.

### Deviations from SPEC
- None in code scope. Spot-check "before/after row count" and "card no longer partial" only partially satisfied (see gaps).
