# Tina "Today" build — STATUS

Source of truth: docs/today-build/SPEC.md. Owner of this file: project-manager.

## Deviations (top-level)

- D1. The project-manager and code-reviewer agents were created in .claude/agents/ this session but are not registered as subagent types until Claude Code restarts. Both roles run as general-purpose agents given the exact definition prompts. Tool restrictions (read-only for reviewer; STATUS.md-only for PM) are prompt-enforced, not harness-enforced.

## Open questions for Gisete

- Q1. Working tree has uncommitted, unrelated work from before this build: src/app/dashboard/components/{hypnogram-chart,sleep-score-card}.tsx, src/app/dashboard/sleep/page.tsx, src/db/schema.ts, src/lib/charts/stage-colors.ts, src/lib/format.ts, src/lib/sync/read.ts, .claude/settings.local.json, plus untracked src/app/actions/feelings.ts, src/app/dashboard/components/{night-feeling-input,night-summary-hero}.tsx, src/lib/analytics/feeling-tags.ts. This build will also touch src/db/schema.ts and src/lib/sync/read.ts, so per-phase commits cannot cleanly separate them. Builder plan: partial staging (`git add -p` style) so each phase commit holds only its hunks. Alternative: Gisete commits the pre-existing work first. Which do you prefer?
- Q2. (Informational) If the app is ever deployed (Vercel/container) it runs in UTC and every localToday()/weekday computation breaks around midnight. Needs a TZ decision before any deploy.

## Phase 0 — Read-only investigation: DONE

Findings (from builder):

1. Landing/nav: src/app/page.tsx is the sign-in page and redirects authenticated users to /dashboard. /dashboard (src/app/dashboard/page.tsx) is "Dashboard Overview". Nav is a hardcoded sidebar in src/app/dashboard/layout.tsx (/dashboard, /dashboard/sleep, /dashboard/heart, plus disabled "Exercise & Endurance — Soon"). Sidebar is `hidden md:flex`, so there is NO mobile nav today. The sign-in server action in src/app/page.tsx uses redirectTo "/dashboard"; Phase 4 must update it too.
2. Timezone: localToday() uses JS runtime local tz. Verified on this machine: `date` = WEST, Intl timezone = Europe/Lisbon, no TZ env var. No Dockerfile / vercel config / TZ setting in repo, so the app runs via next dev/start on this Mac, matching Europe/Lisbon. Caveat: see Q2. Sync window bounds use new Date().toISOString() (UTC), pre-existing and out of scope.
3. HR samples: lazy-fetched. ensureNightSamples() in src/app/actions/sync.ts reads the heart_rate_samples cache (>=10 samples), otherwise calls Google; called from readDashboardData (sleep page read path) and at end of runGoogleSync for the latest main session. Headline score is computed by pure assembleDashboardData() in src/lib/sync/assemble.ts (calculateSleepScoreBreakdown -> lastNight.holisticScore); it cannot call Google. Consequence: Today must NOT call readDashboardData/loadPageData; it reads sessions + cached samples from the DB itself and calls assembleDashboardData directly.
4. Google steps probe (read-only, 2026-10-20): data type `steps` (intraday per-minute points; steps.count is a STRING; civilStartTime.date gives local civil date). `daily-steps` does not exist (400). POST /v4/users/me/dataTypes/steps/dataPoints:dailyRollUp with body {range:{start:{date:{year,month,day}},end:{date:{...}}}} returns rollupDataPoints[] with civilStartTime.date and steps.countSum (string). Probe: 2026-10-19 = 9562, 2026-10-20 = 6920. With end 2026-10-21 only 19 and 20 returned (end appears exclusive; to include today use end = tomorrow, to be confirmed in Phase 1). Steps are available, so Phase 1 is not skipped.
5. daily_activity_summaries: id, user_id, activity_date (date), light/moderate/vigorous/peak minutes (int notNull default 0), created_at, updated_at; uniqueIndex (user_id, activity_date). persistActivitySummaries() does insert...onConflictDoUpdate REPLACING all four minute columns from EXCLUDED (not COALESCE), setting updated_at=NOW(). Steps share this row, so steps need their own upsert setting only steps (+updated_at) on conflict; the AZM upsert stays unchanged and does not touch steps (steps not in its set clause).

Pre-existing dirty working tree: see Q1.

### Phase 0 -> Phase 1 decision: GO

Server tz matches Europe/Lisbon (no STOP condition). Steps data type exists. Deviations from SPEC: none beyond D1. Phase 4 must also change the sign-in redirectTo and consider mobile nav (noted for later phases).

## Phase 1 — Daily steps (sync path only): DONE, with commit defect fixed in Phase 2

**DEFECT (commit c322cbb):** the committed src/db/schema.ts has `steps: integer("steps")` placed INSIDE the usersRelations object instead of the dailyActivitySummaries columns (zero-context partial patch via `git apply --cached --unidiff-zero`). The Phase 1 gate ran on the working tree (correct), so tsc/build/push/live-DB checks passed, but HEAD did not match what was tested. Caught by the Phase 2 reviewer, confirmed with `git show HEAD:src/db/schema.ts`. Fixed by the Phase 2 commit (content-built schema.ts). PROCESS CHANGE: typecheck the STAGED snapshot (checkout-index into a temp tree) before every commit.

Gate (builder's reported output, re-run after final edit): `npx tsc --noEmit` clean ("TSC OK"); `npm run build` "Compiled successfully", all routes listed; `npx drizzle-kit push` "[✓] Changes applied", no data-loss/drop/rename prompts. Push also applied the pre-existing daily_feeling_tags schema (not Phase 1 work, additive).

Scope check (git diff --stat): client.ts, normalizers.ts, persist.ts, actions/sync.ts hunks are steps-only. schema.ts (+21) = steps column (Phase 1) + pre-existing daily_feeling_tags table/relations (NOT Phase 1; partial staging required, see Q1). Nothing in sleep scoring, heart analytics, sleep/heart pages, RECONCILE_WINDOW_DAYS, or persistActivitySummaries. No Google call added to any read path (steps fetch only in runGoogleSync).

Spot-check 1 (real DB, last 7 days + today): 10-14 8886 | 10-15 6363 | 10-16 9421 | 10-17 21450 | 10-18 4495 | 10-19 9562 | 10-20 6920 | 10-21 1615 (today, partial). Earlier probe matched 10-19=9562, 10-20=6920. Gisete to compare with Fitbit app.
Spot-check 2: today's row tampered to 1, then 99999 (higher than real); re-run returned it to 1615 both times with updated_at advanced. Overwrite semantics confirmed, including lower incoming value.
AZM not clobbered: 113 pre-existing rows untouched; 8 rows (10-14..10-21) newly created by steps upsert with zone minutes 0.

Review (code-reviewer): No blocking findings. Non-blocking: #1 unguarded persistDailySteps await -> FIXED (try/catch+warn, gate re-run); #2 reason?.message typing -> left, mirrors zone warning; #3/#4 duplicated 401-retry block -> left, out of scope; #5 NULL steps = no data, UI must treat as such -> carry to Phase 4; #6 COALESCE concern moot, AZM upsert uses EXCLUDED replace (verified).

Deviations: spot-check ran the real fetch->normalize->persist functions via tsx against the live DB, not the full /api/sync route (needs authenticated session; Chrome extension not connected). Wiring in runGoogleSync verified by tsc/build/review only.

Open questions:
- Q3. Gisete: open /api/sync?days=7 in the logged-in browser (or press Sync) and re-run a steps SELECT to exercise the real wiring.
- Q4. The 8 steps-only rows have zone minutes 0 until an AZM sync covers them, so the AZM trend card may show 0 for 10-14..10-21 (pre-existing gap: zone sync had not produced rows for those days).

### Phase 1 -> Phase 2 decision: GO
All sign-off checks satisfied; the two caveats are recorded, not blocking (unit pieces proven live; route wiring is a thin Promise.allSettled addition).

## Phase 2 — Schema + pure engines: DONE

Gate (builder): tsc clean; build "Compiled successfully"; `drizzle-kit push` "[✓] Changes applied", no data-loss/rename/drop prompts (8 new tables only). Staged snapshot typechecked separately: "STAGED TREE TSC OK".
Verified by PM: `git diff --cached --stat` = schema.ts (+110/-3, includes steps relocation fix), src/lib/today/{index,motivation,resolve-day,sleep-nudge,types,weekday}.ts, scripts/today-engines-check.ts; nothing else staged. daily_feeling_tags remains unstaged.
Spot-checks (scripts/today-engines-check.ts, ALL CHECKS PASSED under Europe/Lisbon, America/Los_Angeles, Pacific/Auckland, UTC):
1. Weekday: Sun 2026-10-18 -> 7, Mon 2026-10-19 -> 1 (still 7 under LA where new Date("2026-10-18") would be Saturday).
2. Motivation: 14 dates -> 4,2,5,1,2,4,5,1,2,4,5,1,1,5; empty -> null; stable across calls/input order; inactive line never picked.
3. Backup round-trip: {"kind":"backup","conditionId":7,"conditionName":"Low energy","items":[{"name":"Walk","details":"15 min","done":false}]}; snapshot wins over edited template; JSON-safe. Meals: logged breakfast keeps "Oats" after template edit to "Eggs"; null-id orphan lunch still listed.
4. Nudge: null -> []; 64 vs threshold 70 -> [1]; 70 -> [] (strictly below; archived/null-threshold excluded).
Review (code-reviewer): No blocking findings.

Deviation D2: ExerciseLogState backup.conditionId is `number | null` (FK nullable); conditionName falls back to "Backup" if snapshot null.

Carry-forward (non-blocking):
- Phase 3: validate status/slot/kind (text with $type) and weekday 1..7 in pure validation.
- Phase 4: meal_logs upsert must only target rows with non-null meal_plan_item_id (unique index treats NULLs as distinct); server action must validate date format before isoWeekdayOf (NaN on malformed input); NULL steps = no data in UI.
- Add relations/user_id indexes for new tables only if needed.
- Accepted low risk: DayTemplates may hold all weekdays (resolveDay filters); script does not test a meal item moved to another weekday.

### Phase 2 -> Phase 3 decision: GO
Criteria met, no unresolved blocking, diff in scope, Phase 1 commit defect repaired.

## Phase 3 — Plan editor: DONE (UI click-through pending, see Q5)

Gate (builder, re-run after fix round 1): tsc clean; build "Compiled successfully" with /dashboard/plan in route list; staged-snapshot tsc "STAGED TREE TSC OK". No schema change, no push.
Verified by PM: `git diff --cached --stat` = 14 files, +1487: src/app/actions/plan.ts, dashboard/layout.tsx (+8, nav link), dashboard/plan/** (page + 6 components), src/lib/today/{index,persist,read,types,validate}.ts. Nothing in sleep/heart/scoring/sync staged; feelings.ts, night-*.tsx, feeling-tags.ts, schema.ts remain unstaged.

DEVIATION D3: Chrome extension not connected, so "create items via the UI" was NOT done; UI only compiled/built. Instead the exact persist.ts + validate.ts functions the actions call were run against the live DB with throwaway users (all rows deleted, leftovers 0). Server Action auth path and revalidatePath not exercised live.
Spot-check output (live DB): reorder Squats(0)/Run(1) then move Run up -> Squats 1, Run 0. Cross-user move/delete = no-op, insertConditionOption on another user's condition -> false. copyMealDayToAllDays -> 14 rows over weekdays 1..7. Condition 'Low energy' below 70 archived=true persisted (not deleted), option row kept. mindset_items 1, motivation_lines 1. Validation rejects weekday 8, "3", slot "brunch", kind "x", threshold 0/101/NaN, blank name; accepts weekday 7, snack, threshold null/70.

Review: Round 1 one BLOCKING (copy-day from an empty source day could wipe all other days' meals on direct POST) -> FIXED (persist returns false before any write; action returns ok:false), verified live (empty source -> false, existing row kept; Tuesday source -> true, 7 rows). Round 2: no blocking, nothing new. Also fixed: mutate() try/catch, h1 token class.
Not changed, justified: option ownership checked in a separate query (safe single-user; rename to ownsOption later); nextPosition race harmless (ties by id, moveWithin renumbers); one pending flag per section; stale error on tab switch; no move for conditions/options (not in SPEC).

Open question:
- Q5. Gisete: click through /dashboard/plan once (add a workout, add a meal, create then archive a condition, copy a meal day to all days) as the real UI verification.

Carry-forward to Phase 4:
- (a) copy-to-all-days deletes and recreates other days' meal_plan_items, setting meal_logs.meal_plan_item_id NULL for logs on those days; for today/yesterday a logged meal could show next to a fresh unlogged copy. Phase 4 must match orphaned logs to template items (slot + description snapshot) or otherwise avoid duplicates.
- (b) meal_logs null-FK rows are not deduped by the unique index.
- (c) Phase 4/5 readers must filter archived conditions/options (nudge already skips archived).
- (d) Validate date format before isoWeekdayOf.
- Plus earlier: NULL steps = no data; sign-in redirectTo and mobile nav.

### Phase 3 -> Phase 4 decision: GO
Gate green, scope clean, blocking finding fixed and re-reviewed, DB-level checks pass. UI click-through is an accepted, recorded gap (Q5), not blocking since logic is live-verified and UI is thin.

## Phase 4 — Today screen + logging: DONE (UI/auth path not exercised live, see Q6)

Gate (builder, re-run after fix round 1): tsc clean; build "Compiled successfully" with /dashboard/today and /dashboard/plan in route list; staged-snapshot tsc "STAGED TREE TSC OK". No schema change, no push. scripts/today-engines-check.ts ALL CHECKS PASSED under Europe/Lisbon, America/Los_Angeles, Pacific/Auckland. Process incident: `git add src/app/actions` accidentally staged feelings.ts; caught by snapshot check, unstaged, verified untracked.
Verified by PM: `git diff --cached --stat` = 21 files, +1052/-17: scripts/today-engines-check.ts, src/app/actions/{plan,today}.ts, dashboard/layout.tsx, dashboard/today/** (page + 6 components), src/app/page.tsx, src/lib/today/{exercise-log,index,last-night-score,log-date,persist,read,resolve-day,types,validate}.ts. feelings.ts, night-*.tsx, feeling-tags.ts remain untracked/unstaged; sleep page, schema.ts, sync.ts, scoring not staged.
Spot-checks (builder output, live DB, throwaway user, cleaned up; run the same pure builders + persist functions the actions call):
1. Planned log keeps OLD text ("Squats" 3×12) after template edit to "Squats (EDITED)".
2. Backup row printed with condition_id 2, snapshot "Low energy", 2 items; snapshot survives archiving; planned->backup leaves 1 row per (user,date).
3. Meal check-off; template edit+delete: log keeps description_snapshot "Salad", FK null, followed true; resolveDay still shows it; wrong weekday -> false.
4. Re-adding identical meal + toggle re-attaches orphan: rows=1, followed=false (carry-forwards a/b RESOLVED).
5. Real account, stored data only, 0 outbound fetches: steps {yesterday 6920, today 1615}; last night "not-synced" (DB last sync 2026-07-18, genuine); sync stale true. Scored path proven via as-if dates: 07-17 -> 81 partial:false (11324 samples); 07-16 -> 75 partial:true (0 samples, cardiac null); 07-16 as-if -> 82.
Date window: validateLogDate accepts today/yesterday, rejects 2 days ago, tomorrow, malformed/null/number/ISO-with-time (fixtures). Carry-forward (c) archived filtering and (d) date validation handled per builder/reviewer.
Review: Round 1 all 7 invariants hold; 2 BLOCKING FIXED (meal-block moved-weekday toggle sent wrong id -> "not found"; orphan adoption could violate unique index, verified live). Round 2: BLOCKING none, nothing new. Also fixed: "Skip today" -> "Skip"; plan.ts mutate() revalidates /dashboard/today. Today page does not import readDashboardData/loadPageData/ensureNightSamples/google (import graph traced); sync.ts, scoring, heart, sleep/heart pages untouched.
Not changed, justified: index-based exercise toggle may hit wrong item if template edited between render and click on an unlogged day (single user, low risk); cross-tab last-write-wins; TODAY_STALE_AFTER_HOURS=6 duplicated from sync.ts (documented); steps-card own number format.

DEVIATION D4: UI never clicked (Chrome extension not connected); Server Actions' auth/revalidate path and the Today page's real render were only compiled/typechecked, not run. Sign-in redirectTo change untested live.

Open question:
- Q6. Gisete: sign in and open /dashboard/today, then click through (check items, backup flow, meal check-off, Yesterday tab). This also triggers the first auto-sync (DB last synced 2026-07-18). That sync fetches only a 3-day window, so nights between 07-18 and ~3 days ago stay missing unless /api/sync?days=N is run (existing path, unchanged). Last-night card will show "Not synced yet" until then.

### Phase 4 -> Phase 5 decision: GO
Gate green, scope clean (unrelated work not staged), 2 blocking findings fixed and re-reviewed, DB-level checks pass, server-tz STOP did not trigger. UI/auth gap recorded (D4/Q6), not blocking.

## Phase 5 — Sleep nudge: OPEN

Criteria (SPEC): on Today, when last night's score is below a condition's threshold, visually highlight that condition with a line like "Last night scored 64, consider this." Suggestion only, never auto-swap (no automatic status change/backup log). Use pure sleep-nudge.ts with the Phase 4 last-night score (stored data only, no Google call); null/not-synced score -> no highlight; archived conditions excluded; strictly-below threshold.
Spot-checks: (1) fixture-check via sleep-nudge.ts (null -> none; 64 vs 70 -> highlighted; 70 -> none; archived excluded); (2) on the real DB report last night's score and which conditions (if any) would be highlighted; note that the live last night is currently "not-synced", so also report the as-if scored case and state which it is. Gate: tsc, build, staged-snapshot tsc; diff limited to Today UI/lib, nothing unrelated staged.

Status: open, awaiting implementation.

## Phase 4 criteria (archived)

Criteria (SPEC Phase 4): new Today route as landing (update sign-in redirectTo; sleep/heart stay in nav; consider mobile nav). Blocks: motivation line; today's workout (checkable items) with "Not feeling great?" listing active (non-archived) conditions, tap shows options (multi-select), logs status 'backup' with options snapshotted; Skip; meal plan by slot with check-off; mantras; collapsible strategies via shared expandable-card; steps (yesterday primary, today "so far", NULL = no data); compact last-night Sleep Score card linking to sleep page. Logging limited to today/yesterday with toggle; server action validates date format first, then that it is one of the two (local date helpers). Last-night score from stored data only: no lazy HR fetch, no Google call; cardiac=null with "partial" indicator when samples uncached; "Not synced yet" when no session. Same stale-view auto-sync trigger as sleep page.
Spot-checks: log planned workout, edit weekday template, confirm log row keeps old text (SQL); log a backup and print row; check off a meal, delete the template item, confirm log row keeps description_snapshot. Add: copy-to-all-days then confirm no duplicate of a logged meal (carry-forward a/b); archived conditions/options not shown. Gate: tsc, build, staged-snapshot tsc.

## Phase 3 criteria (archived)

Criteria (SPEC): plan page linked from nav with sections: Weekly workouts (weekday tabs, add/edit/reorder/delete), Meal plan (weekday tabs, by slot, "copy this day to all days"), Backup conditions (create/rename/archive, optional sleep-score-below threshold, manage options), Mantras & strategies, Motivation lines. Server actions orchestrate only (auth -> validate -> persist -> revalidate); DB writes in new src/lib/today/persist.ts; validation pure in src/lib (must enforce weekday 1..7 and status/slot/kind enums). Existing token classes and card/expand components, no raw palette values.
Spot-checks: create items via the UI then SQL-select them; archive a condition and confirm the row persists with archived=true. Gate: tsc, build, staged-snapshot tsc.

### Acceptance criteria (from SPEC)
- New additive tables in src/db/schema.ts, all scoped by user_id, applied via `npx drizzle-kit push`: exercise_plan_items, meal_plan_items, conditions (archived, never hard-deleted; sleep_score_below nullable), condition_options, mindset_items, motivation_lines, exercise_day_logs (uniqueIndex user_id+date; items jsonb snapshot; condition_name_snapshot), meal_logs (uniqueIndex user_id+date+meal_plan_item_id; FK set null on delete; description_snapshot). Snapshot rule: edits to templates never alter past logs.
- Pure engines in src/lib/today/: weekday.ts (via src/lib/dates.ts only), resolve-day.ts (TodayPlan; exercise log state discriminated union unlogged|planned|backup|skipped), motivation.ts (stable hash of date string mod count, lines ordered by id, empty -> null), sleep-nudge.ts (null score -> nothing), shared types.ts, index.ts barrel. No React/Next/DB imports, explicit return interfaces.
- STOP if push warns about data loss or asks to drop/rename. Scope guard unchanged.

### Spot-checks (npx tsx, fixtures; record real output)
1. A Sunday and a Monday resolve to ISO 7 and 1, including a date where UTC would differ.
2. Motivation stable across calls, changes across dates.
3. A backup log round-trips through resolve-day.
4. Null score -> no nudge; score 64 with threshold 70 highlights that condition.
Plus gate: tsc, build, push output.

### PM checks at sign-off
tsc/build/push actual output; all four spot-checks with output; no unresolved BLOCKING; diff limited to schema.ts (new tables only; keep daily_feeling_tags hunk out of commit) and src/lib/today/**.

Status: open, awaiting implementation.
