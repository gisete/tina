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

## Task 4 — AZM light-minutes investigation (findings; raw sample still outstanding)
No code changed. Evidence used: `src/lib/google/{client,normalizers}.ts`, `src/lib/analytics/activity.ts`, `src/lib/sync/activity-summaries.ts`, Google Health API reference (via web fetch), and a read-only aggregate of `daily_activity_summaries` (210 rows).

**What the code does.** The sync fetches the `time-in-heart-rate-zone` data type (one point per worn minute, `heartRateZoneType` ∈ LIGHT/MODERATE/VIGOROUS/PEAK), sums minutes per zone per civil day (`aggregateZoneMinutes`), stores them, and computes AZM live as `moderate*1 + vigorous*2 + peak*2` (`ZONE_AZM_WEIGHT`; LIGHT weight 0).

**Stored data (read-only).** 209/210 days have light > 0 (avg ≈ 1,200 min on those days); moderate > 0 on 77 days (when positive, avg 6 min, max 37); vigorous > 0 on 4 days (max 4); peak never > 0. Last 14 days: light 1,269–1,486 on fully worn days, moderate 0–12 except 37 on 2026-10-17 (steps 21,450).

**Cause (high confidence, not yet raw-confirmed).** `LIGHT` is not an "out-of-range/ignore" bucket — it is the lowest heart-rate zone, and this data type reports a zone for every worn minute, so light ≈ total worn minutes by construction (1,270–1,430 of 1,440). That part is correct data, not a bug. The real problem is the **assumed mapping to Fitbit AZM**: the code treats Google's MODERATE/VIGOROUS/PEAK as Fitbit's fat-burn/cardio/peak (weights 1/2/2), but Google's zones come from a Karvonen (heart-rate-reserve) computation per day (`daily-heart-rate-zones` holds each zone's min/max bpm, "based on the Karvonen algorithm for a specific day") and the docs give no equivalence to Fitbit's %-of-max zones. With a resting HR near 70, Karvonen "moderate" starts at a much higher bpm than Fitbit's fat-burn floor, so ordinary walking days land in LIGHT and moderate/vigorous/peak are ~0 (matches the data: even 14,619 and 21,450-step days show moderate 12 and 37). The same reference also lists a dedicated Active Zone Minutes representation with its own zone enum (FAT_BURN / CARDIO / PEAK) and the 1×/2× weighting — i.e. the API appears to expose the *actual* AZM, which we never fetch.
Secondary finding: 2026-10-16 has light 0 with 9,421 steps — zone data was missing for a worn day, and the column default (0) made it look like a measured zero (this is what Task 3's nullable columns address).

**Proposed fix (not applied).** (1) Confirm with one raw response (below). (2) Stop deriving AZM from Karvonen zone minutes: fetch the API's own active-zone-minutes data type (per-day total, via `dailyRollUp` if supported, else the interval points) and store/read that number; keep zone minutes only as an HR-intensity breakdown, labelled as Google zones. (3) Or, if zones must stay the source, fetch `daily-heart-rate-zones` and re-bucket minute HR against Fitbit's thresholds — more work and the least faithful to what the Fitbit app shows. Recommend (2). Either is a change to the zone mapping/metric math, so it needs your go-ahead.

**To confirm:** one raw `time-in-heart-rate-zone` page plus the day's `daily-heart-rate-zones` and an active-zone-minutes sample for a day where the app showed AZM > 0. Needs a Google call outside the sync path (see the plan.md question).

## Task 5 — agent authentication (commit: see git log --grep "Task 5")
- New table `api_tokens` (brand new; id, user_id, name, token_hash unique, scopes text[], created_at, last_used_at, revoked_at) in schema.ts. **Not pushed** — the table does not exist in the live DB yet.
- `src/lib/api/token.ts`: `hashToken` (SHA-256 hex), `extractBearer`, `verifyApiToken` (order: missing → invalid → revoked → insufficient_scope; constant-time hash compare), `TokenRecord`/`TokenVerdict` types; fixture covers every branch and the ordering.
- `scripts/create-api-token.ts <name> <read,sync> [email]` (prints plaintext once, stores the hash) and `scripts/revoke-api-token.ts <uuid>`. **Neither was run.**
- Middleware: there is no Auth.js middleware/proxy file in the repo (checked `middleware.*`/`proxy.*` in src and root; Next 16 would call it `proxy.ts`), so nothing redirects `/api/v1/*` to login. `/api/v1` routes will authenticate by Bearer only. Re-check if a proxy is ever added.
- Verified: `npm run check`; code-reviewer: no blocking findings.
- **Needs you:** (1) `npx drizzle-kit push` — creates `api_tokens` and applies the Task 3 AZM nullable change (review the Task 3 diff first). (2) `npx tsx scripts/create-api-token.ts agent read,sync`. (3) Put the printed token in `.env.local` as `TINA_API_TOKEN` (I never print or read that file).
