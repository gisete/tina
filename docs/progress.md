# Progress

One short entry per finished task: what changed, commit hash, what was verified, anything to check by eye.

## Task 0 — harness (9e01300)
- Added `npm run check` (tsc, lint --max-warnings 0, build, all `*.fixture.ts` via `scripts/run-fixtures.sh`), docs/plan.md, docs/progress.md, "Autonomous work rules" in AGENTS.md; AGENTS.md Verification now points at `npm run check`.
- Lint was not one error but 2 errors + 11 warnings; all fixed behaviour-neutrally. The Date.now() purity fix: `GapTrendChart` takes a required `nowMs` prop; callers (`SleepCharts`, `HrTrendChart`, and `RecoveryBalanceChart` internally) take a mount-time `useState(() => Date.now())` snapshot. Side effect: the "Not synced yet" vs "No reading" tooltip decision is judged at page-load time, not hover time.
- Removed an unused `RESTLESS_MAX_MS` const (no math change). One `eslint-disable` on the night-heart-chart useMemo deps (layout is rebuilt each render by design).
- code-reviewer subagent is registered (`.claude/agents/code-reviewer.md`) and reviewed the diff: no blocking findings.
- Verified: `npm run check` exit 0.
- By eye: nothing.

## Task 1 — heart-trend baseline commit (hash: ae70219)
- Committed the pending rolling 7-reading baseline work as it stood. The only code beyond it: threading Task 0's `nowMs` prop into the `HrMetricCard` calls in hr-trend-chart.tsx (the two changes touched the same lines).
- Verified: `npm run check` exit 0; code-reviewer: no blocking findings.
- Reviewer non-blocking notes left as-is (Task 1 is "no code changes"): `summaryKey` duplicates `dataKey` in `MetricConfig`; fixture lacks a hole-in-history case and a "<3 pre-window readings → null" window case.
- By eye: heart page RHR/HRV cards show a dashed baseline that starts on the first day of each window (7/30/90).

## Task 2 — /api/sync?days=N on the chunked path (already done: 521d925, dc6ec68)
- No new code. The work predates this plan: `/api/sync?days=N` runs `runRangeSync` (per-chunk civil-date `syncDateRange`, the same unit step.ts uses; never moves synced_through/last_synced_at) and the plain GET runs `runSyncStep({force:true})`. `runGoogleSync` and `shouldAutoSync` are gone; `STALE_AFTER_HOURS` is the single 6-hour constant in `src/lib/sync/catch-up.ts` (also used by data-gaps.ts and step.ts).
- Verified now: grep finds no `runGoogleSync`/`shouldAutoSync` anywhere; one `STALE_AFTER_HOURS` definition.
- The before/after `?days=30` AZM snapshot diff was done earlier and is recorded in `docs/legacy-sync-chunked/STATUS.md`: after the range.ts civil-date fix, vs original baseline changed=1 (2026-10-04 light 943→1423, a repair), decreased=0, first day unchanged. I did NOT re-run it: it would be a real Google call plus a write to the shared DB for no new information. Say so if you want a fresh run.
- By eye: the HTTP route itself was never exercised end to end (that STATUS notes it); one manual hit of `/api/sync?days=30` while logged in would close it.
