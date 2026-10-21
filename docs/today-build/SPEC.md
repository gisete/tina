## Setup — before Phase 0

1. Save this entire prompt verbatim to `docs/today-build/SPEC.md`. Subagents can't see this conversation; that file is their source of truth.

2. Create `.claude/agents/code-reviewer.md`:

```
---
name: code-reviewer
description: Read-only reviewer for Tina. Use after each build phase, before project-manager sign-off, to review the phase's diff against AGENTS.md and the spec invariants.
tools: Read, Grep, Glob, Bash
---
You are a strict, read-only code reviewer for Tina, a single-user Next.js + Drizzle health dashboard. Never edit files. Use Bash only for read-only commands (git diff, git status, grep, npx tsc --noEmit).

Read AGENTS.md and docs/today-build/SPEC.md first. Review only the diff for the phase you're given.

Check AGENTS.md conventions: logic with branching/math/dates lives in pure src/lib modules (no React/Next/DB imports); server actions orchestrate only; no `any`; explicit return interfaces; discriminated unions narrowed correctly; calendar dates only via src/lib/dates.ts (flag any toISOString(), new Date("YYYY-MM-DD"), or .split("T")[0] used for calendar dates); token classes not raw palette values; schema changes additive.

Check spec invariants: no Google API call reachable from any render/read path (trace imports from page/route components); logs snapshot planned text and never join back to templates for display; conditions archived, never hard-deleted; steps upsert overwrites (no COALESCE-preserve), AZM upsert unchanged; nothing outside the phase's scope touched (sleep scoring, heart analytics, sync window).

Output exactly two sections: BLOCKING (convention/invariant violations or correctness bugs, each with file:line and the concrete fix) and NON-BLOCKING (style, naming, suggestions). If BLOCKING is empty, say "No blocking findings." Do not praise; do not restate the code.
```

3. Create `.claude/agents/project-manager.md`:

```
---
name: project-manager
description: Tracks the Tina Today build against docs/today-build/SPEC.md. Use before starting each phase and after each phase's review to verify acceptance criteria and decide go/stop.
tools: Read, Write, Edit, Grep, Glob, Bash
---
You manage the phased build in docs/today-build/SPEC.md and own docs/today-build/STATUS.md. You never edit application code; the only file you write is STATUS.md. Use Bash only for read-only commands (git diff --stat, git log).

Before a phase: restate its acceptance criteria and spot-checks from SPEC.md in STATUS.md.

After a phase (given the builder's gate output and the code-reviewer's findings), verify:
- tsc and build passed (actual output, not a claim)
- every listed spot-check was actually run, with real output recorded
- no unresolved BLOCKING review findings
- git diff --stat touches nothing outside the phase's scope

Record in STATUS.md per phase: status (done / stopped), gate results, spot-check output, review findings and how each was resolved, deviations from SPEC with reasons, and open questions for Gisete.

Decide GO or STOP. STOP if any check above fails, if a finding was dismissed without justification, or if Phase 0 reported that the server timezone doesn't match Europe/Lisbon (stop before Phase 4 and record it as a decision needed from Gisete). When uncertain, STOP; a stopped build is cheap, a wrong one isn't.
```

## Workflow for every phase

1. Invoke project-manager to open the phase.
2. Implement the phase.
3. Run the gate: `npx tsc --noEmit`, `npm run build`, and the phase's spot-checks. Capture actual output.
4. Invoke code-reviewer on the phase's diff.
5. Fix all BLOCKING findings, then re-run the gate and the reviewer. Maximum two fix rounds; if blocking findings remain, STOP.
6. Invoke project-manager for sign-off. Proceed only on GO.
7. Commit the phase as its own commit ("today: phase N — <name>") so phases can be reverted individually.

If `drizzle-kit push` warns about data loss or asks to drop/rename anything, STOP; every schema change here is additive. When the build ends (finished or stopped), your final message is the contents of docs/today-build/STATUS.md.

---

# Tina: "Today" home screen — phased build

Read AGENTS.md first and follow it throughout. Next.js in this repo has breaking changes: check node_modules/next/dist/docs/ before writing route, layout, or Server Action code.

Execute phases in order. Each phase ends with a gate: `npx tsc --noEmit`, `npm run build`, and the listed spot-checks. If a gate fails and you can't fix it within the phase's scope, STOP and report. Do not continue to the next phase on a red gate. If `drizzle-kit push` warns about data loss or asks to drop/rename anything, STOP: every schema change here is additive. At the end, give me a report per phase: what changed, gate results, spot-check output, and anything you were unsure about.

Scope guard: do not change sleep scoring, heart analytics, existing sleep/heart pages (beyond navigation), or the 3-day sync window. No Google calls on any render/read path.

## Phase 0 — Read-only investigation (no code changes)
Report findings before proceeding:
1. Current landing route and nav structure.
2. How `localToday()` behaves server-side: what timezone does the Next.js server/container run in? If it's not Europe/Lisbon (or not otherwise matching my local time), report this. Proceed, but flag it prominently. All date logic in this build depends on it.
3. How the sleep page obtains intra-night HR samples for the most recent night: stored at sync, or lazy-fetched on first view? Identify the function that computes the headline score and whether calling it can trigger a Google fetch.
4. Google Health API v4: identify the daily steps data type and its response shape (read-only probe against my account, one day). If steps aren't available, report it, skip Phase 1, and continue.
5. Current `daily_activity_summaries` schema and its upsert.

## Phase 1 — Daily steps (sync path only)
- Add nullable `steps integer` to `daily_activity_summaries`, keyed by local calendar date like the existing AZM data. Apply with `npx drizzle-kit push`.
- Fetch steps in the existing sync path alongside AZM; include steps in the existing `/api/sync?days=N` backfill.
- IMPORTANT: today's steps are partial and must be overwritten on each sync. Do NOT apply the COALESCE-preserve pattern to steps; use the incoming value when it's non-null. Leave AZM upsert behavior unchanged.
- Gate spot-checks: run a sync, then SQL-select the last 7 days of steps and print them. I will compare against the Fitbit app. Confirm a second sync updates today's value.

## Phase 2 — Schema + pure engines
New tables in `src/db/schema.ts` (all scoped by `user_id`, apply with push):
- `exercise_plan_items`: id, user_id, weekday (smallint, ISO 1=Mon..7=Sun), position, name, details (text, nullable, free text like "3×12" or "20 min"), timestamps.
- `meal_plan_items`: id, user_id, weekday (ISO), slot ('breakfast'|'lunch'|'dinner'|'snack'), position, description, timestamps.
- `conditions`: id (stable serial, never reused), user_id, name, position, sleep_score_below (smallint, nullable), archived (boolean, default false). Conditions are archived, never hard-deleted, because logs reference them.
- `condition_options`: id, condition_id, name, details (nullable), position, archived.
- `mindset_items`: id, user_id, kind ('mantra'|'strategy'), text, position.
- `motivation_lines`: id, user_id, text, active (boolean).
- `exercise_day_logs`: user_id, date (local "YYYY-MM-DD"), status ('planned'|'backup'|'skipped'), condition_id (nullable FK), condition_name_snapshot (nullable), items (jsonb snapshot: array of {name, details, done}), note (nullable), timestamps. uniqueIndex on (user_id, date).
- `meal_logs`: user_id, date, meal_plan_item_id (nullable FK, set null on delete), slot, description_snapshot, followed (boolean). uniqueIndex on (user_id, date, meal_plan_item_id).

Snapshot rule: logs store the planned text as it was at log time. Editing a template must never change the meaning of a past log.

Pure engines in `src/lib/today/` (one engine per file, shared `types.ts`, `index.ts` barrel; no React/Next/DB imports; explicit return interfaces; discriminated unions):
- `weekday.ts`: local "YYYY-MM-DD" → ISO weekday, using src/lib/dates.ts helpers only.
- `resolve-day.ts`: given a date, templates, and that day's logs → a serializable `TodayPlan` (exercise items, meal items by slot, log state). The exercise log state is a discriminated union: `{ kind: 'unlogged' } | { kind: 'planned', items } | { kind: 'backup', conditionId, conditionName, items } | { kind: 'skipped' }`.
- `motivation.ts`: deterministic pick of one active line for a date (stable hash of the date string mod count, lines ordered by id). Empty list → null.
- `sleep-nudge.ts`: given last night's score (number | null) and conditions → which condition IDs to highlight. A null score highlights nothing.
- Gate spot-checks (npx tsx with fixtures): a Sunday and a Monday resolve to the right weekdays, including a date where UTC would differ; motivation is stable across calls and changes across dates; a backup log round-trips through resolve-day; a null score yields no nudge; a score of 64 with threshold 70 highlights that condition.

## Phase 3 — Plan editor
- A plan page (link it from nav) with sections: Weekly workouts (weekday tabs, add/edit/reorder/delete items), Meal plan (weekday tabs, items by slot, plus a "copy this day to all days" action), Backup conditions (create/rename/archive conditions, set optional "sleep score below" threshold, manage each condition's options), Mantras & strategies, Motivation lines.
- Server Actions orchestrate only (auth → validate → persist → revalidate). Put DB writes in a new `src/lib/today/persist.ts` following the pattern of src/lib/sync/persist.ts. Validation logic is pure in src/lib.
- Use existing token classes and the existing card/expand components; no raw palette values.
- Gate spot-checks: create items via the UI, then SQL-select them; archive a condition and confirm the row persists with archived=true.

## Phase 4 — Today screen + logging
- New Today route; make it the landing route. Sleep/heart remain reachable from nav, unchanged.
- Blocks top to bottom: Motivation line, Today's workout (planned items, each checkable) with a "Not feeling great?" section below listing active conditions; tapping one shows its options as a menu (multi-select) and logs status 'backup' with the chosen options snapshotted; a Skip action; Meal plan by slot with check-off; Mantras (all shown); Strategies (collapsible, using the shared expandable-card); Steps (yesterday's total as primary, today's as "so far"); a compact last-night Sleep Score card linking to the sleep page.
- Logging scope: today and yesterday only, with a small toggle to switch between them. The server action validates the date is one of those two using local date helpers.
- Last-night score: compute from stored data only. Must NOT trigger the lazy HR-sample fetch or any Google call. If samples for that night aren't cached, compute with cardiac = null (the engine redistributes) and show a subtle "partial" indicator. If no session exists for last night yet, show "Not synced yet" with no score.
- Add the same stale-view auto-sync trigger the sleep page uses, so opening Today in the morning pulls last night.
- Gate spot-checks: log a planned workout, then edit that weekday's template, then confirm the log row still shows the old text (SQL select). Log a backup and print the row. Check off a meal, delete that meal item from the template, and confirm the log row keeps description_snapshot.

## Phase 5 — Sleep nudge
- On Today, when last night's score is below a condition's threshold, visually highlight that condition with a line like "Last night scored 64, consider this." Suggestion only, never auto-swap.
- Gate spot-checks: fixture-check via sleep-nudge.ts; on my real DB, report last night's score and which conditions (if any) would be highlighted.
