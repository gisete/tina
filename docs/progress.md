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

## Task 3 — honest absence, data layer (commit: see git log --grep "Task 3")
- New pure TS in `src/lib/api/`: `metric.ts` (the `measured | estimated | derived | unavailable` union, `UnavailableReason`, builders), `absence.ts` (`classifyAbsence`: on/before `synced_through` → `not_worn`, after or no cursor → `not_synced`; `dayMetric`: null → unavailable, a real 0 stays measured 0, today's accumulating values get `flags: ["partial_day"]`), `absence.fixture.ts`, `index.ts` barrel.
- Interpretation: "measured but flagged partial_day" is carried as an optional `flags: ["partial_day"]` on measured/estimated/derived values; `unavailable` + reason `partial_day` stays available for values that cannot exist until the day ends.
- Schema (existing table altered; **NOT pushed**): `daily_activity_summaries.light_minutes/moderate_minutes/vigorous_minutes/peak_minutes`: `integer NOT NULL DEFAULT 0` → `integer` (nullable, no default).
```
-    lightMinutes: integer("light_minutes").notNull().default(0),
-    moderateMinutes: integer("moderate_minutes").notNull().default(0),
-    vigorousMinutes: integer("vigorous_minutes").notNull().default(0),
-    peakMinutes: integer("peak_minutes").notNull().default(0),
+    lightMinutes: integer("light_minutes"),
+    moderateMinutes: integer("moderate_minutes"),
+    vigorousMinutes: integer("vigorous_minutes"),
+    peakMinutes: integer("peak_minutes"),
```
  Equivalent SQL: `ALTER TABLE daily_activity_summaries ALTER COLUMN <c> DROP NOT NULL, ALTER COLUMN <c> DROP DEFAULT;` for the four columns. Existing rows keep their stored values (including historical 0s from the old default — those stay ambiguous; only new steps-only rows will get NULL).
- To keep the dashboard unchanged, `readActivitySummaries` maps NULL → 0 (comment explains); the API layer will read raw nullable rows. Two scripts (`spot-check-azm.ts`, `verify-activity-sync.ts`) got `?? 0` for the type change. The code is safe against both the pre- and post-push DB.
- Verified: `npm run check`; reviewer below. Nothing run against the DB.
- By eye / decision for you: approve the push (or run `npx drizzle-kit push` yourself).
- Reviewer follow-ups to carry: (1) persist.ts comment "zone-minute column defaults (0)" goes stale after the push — update it with the push. (2) `scripts/init-synced-through.ts` sums the four zone columns in SQL; NULL-safe only while they are written together (use coalesce if that changes). (3) **For Task 7:** existing steps-only rows already hold stored zeros; the push does not turn them into NULL, so the API would report those days as measured 0 AZM until an explicit `UPDATE … SET zone cols = NULL` for steps-only rows with all-zero zones (a DB write — needs your OK). The API layer also needs its own nullable zone read, since `readActivitySummaries` masks NULL.
