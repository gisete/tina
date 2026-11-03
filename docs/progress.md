# Progress

One short entry per finished task: what changed, commit hash, what was verified, anything to check by eye.

## Task 0 — harness (9e01300)
- Added `npm run check` (tsc, lint --max-warnings 0, build, all `*.fixture.ts` via `scripts/run-fixtures.sh`), docs/plan.md, docs/progress.md, "Autonomous work rules" in AGENTS.md; AGENTS.md Verification now points at `npm run check`.
- Lint was not one error but 2 errors + 11 warnings; all fixed behaviour-neutrally. The Date.now() purity fix: `GapTrendChart` takes a required `nowMs` prop; callers (`SleepCharts`, `HrTrendChart`, and `RecoveryBalanceChart` internally) take a mount-time `useState(() => Date.now())` snapshot. Side effect: the "Not synced yet" vs "No reading" tooltip decision is judged at page-load time, not hover time.
- Removed an unused `RESTLESS_MAX_MS` const (no math change). One `eslint-disable` on the night-heart-chart useMemo deps (layout is rebuilt each render by design).
- code-reviewer subagent is registered (`.claude/agents/code-reviewer.md`) and reviewed the diff: no blocking findings.
- Verified: `npm run check` exit 0.
- By eye: nothing.

## Task 1 — heart-trend baseline commit (hash: see Task 2 entry header note)
- Committed the pending rolling 7-reading baseline work as it stood. The only code beyond it: threading Task 0's `nowMs` prop into the `HrMetricCard` calls in hr-trend-chart.tsx (the two changes touched the same lines).
- Verified: `npm run check` exit 0; code-reviewer: no blocking findings.
- Reviewer non-blocking notes left as-is (Task 1 is "no code changes"): `summaryKey` duplicates `dataKey` in `MetricConfig`; fixture lacks a hole-in-history case and a "<3 pre-window readings → null" window case.
- By eye: heart page RHR/HRV cards show a dashed baseline that starts on the first day of each window (7/30/90).
