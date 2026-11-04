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

## Task 4 — AZM light-minutes investigation (CORRECTED by the Task 12 probes)
**CORRECTION (supersedes the "Cause" and "Proposed fix" below):** the zone-mapping theory was disproved by the raw `active-zone-minutes` dailyRollUp probes (docs/azm-probe/, commits 6e420ae and 7311f33). Google's fat-burn sum equals the stored `moderate_minutes` exactly on 11 of 12 sampled days (and differs by 1 on the other, 2026-10-23: 13 vs 12); Google's cardio differs from stored `vigorous_minutes` by at most 1 minute on the only two days that have any (2026-09-30: 0 vs 1; 2026-11-03: 2 vs 1). The derived AZM (moderate x1, vigorous/peak x2) therefore matches Google's own figure within +-2 minutes on all 12 days, and the near-zero days are genuinely near zero in Google's data too. Task 12 was closed as not a bug. What stays true below: `light` is the lowest zone and covers nearly all worn time (correct data), and the 2026-10-16 zero was a missing-data default (fixed by Task 3's nullable columns).

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

## Task 6 — API contract (commit: see git log --grep "Task 6")
- `src/lib/api/`: `envelope.ts` (`ApiSuccess`/`ApiFailure` union, `buildSuccess`/`buildFailure`, error codes, `MAX_RANGE_DAYS = 92`), `time.ts` (`formatInstantWithOffset` — ISO 8601 with offset, no `toISOString`), `day.ts` (`DayData` types + pure `buildDayData`), `state.ts` (`StateData` + `buildStateData`), `contract.fixture.ts`.
- Derived values are not recomputed: the builders take outputs of the existing engines (`assembleDashboardData` → `lastNight.holisticScore/holisticBreakdown/restlessness`, `nightHeart`, `cardiacStrain`; `calculateActiveZoneMinutes`; sleep debt and circadian from the engines) and wrap them in the metric union.
- Decisions to check: day D means "the night that ended the morning of D" (same as the dashboard's date picker; implied night = D−1); efficiency is exposed as the stored 0–1 ratio (unit "ratio"); an absent score component's sub-score is `unavailable/not_fetched`; stage-less sessions return `not_supported`; Google auth in `/state` is reported as linked / refresh-token present / access-token expiry plus an explicit note, because auth failures are not persisted anywhere, so "valid as last known" cannot be answered more precisely without a Google call.
- Verified: `npm run check`. code-reviewer found 5 blocking items, all fixed: AZM now `derived` (not `measured`); main-session choice reuses `selectMainSessions`; added the reason `insufficient_data` (too little history/nights to compute) and used it instead of the misleading `not_supported`/`not_synced`/`not_worn` for score, baselines, circadian, debt and strain; circadian threshold now imports the engine's `MIN_CIRCADIAN_NIGHTS`.
- Known/accepted: when a session has no stored UTC offset its instants are written at `+00:00` (the instant is right; the wall clock shown is UTC). Stage minutes are rounded individually so they may differ from `totalSleep` by a minute or two.

## Task 7 — read endpoints (commit: see git log --grep "Task 7")
- `GET /api/v1/day`, `/days` (cap 92, `range_too_large`), `/state` under `src/app/api/v1/`, bearer-only (`src/lib/api-server/http.ts`), scope `read`. Loaders in `src/lib/api-server/read-days.ts` / `read-state.ts` are DB-only: no Google import in either, and HR samples are read from the cache table, never fetched. Pure parameter parsing + fixture in `src/lib/api/params.ts`.
- Score equality: `loadDays` feeds `assembleDashboardData` the same inputs the dashboard gets for `?date=` (90 most recent session rows before the day, 45 heart rows up to it, cached samples) and returns its `lastNight.holisticScore`. **Verified read-only against your DB:** for 2026-10-25 and 2026-10-27 the API score equals a dashboard-equivalent computation (74 = 74, 88 = 88); 2026-10-26 has no 10-25 night → `unavailable/not_worn` (the dashboard likewise shows no recorded night); days after `synced_through` (2026-10-27) → `unavailable/not_synced`, steps/AZM likewise (no zeros).
- Deliberate omission (rule: no DB writes outside the sync path): `api_tokens.last_used_at` is **not** updated on requests. Say so if you want that write added.
- Known difference from the dashboard: a night with no stored HR samples is scored without the intra-night cardiac component here, whereas the dashboard may fetch samples from Google on first view and then score with them. Those API fields say `not_fetched`.
- HTTP not exercised end to end: the `api_tokens` table is not pushed and no token exists. Route-level logic was exercised through the same loaders.
- Reviewer fixes: the range query now loads the dashboard's exact 90-row window for the first day plus every in-range row (pure `rowsBeforeDay`, fixture-proved equal to the single-day query for a 92-day range with 5 rows/date); HR samples are loaded only for the displayed nights (one range clause per night). Read-only check on your DB: for all 92 days up to today, the `/days` payload is byte-identical to the single-day `/day` payload.
- Note: `hasNightSamples` means 'cached samples present', not 'complete'; the dashboard's overview page (no `?date=`) does not filter `lt(today)` so a session keyed today could differ there; parity is exact with `?date=D` pages.
- By eye / for you: after push + token, `curl -H "Authorization: Bearer $TINA_API_TOKEN" localhost:3000/api/v1/day` and `/state`.

## Task 8 — POST /api/v1/sync (commit: see git log --grep "Task 8")
- `src/app/api/v1/sync/route.ts` (scope `sync`) runs `runSyncStep(userId)` (non-forced, the existing step function and its lock) through the pure `runSyncLoop` (`src/lib/api/sync-loop.ts`): at most 8 steps or 45 s. Mapping: first step idle → `fresh` (the step's own staleness/gap rule found nothing due, so no Google call was made); work then idle → `synced`; cap reached with work remaining, or lock held → `pending`; `auth_required`; `error` (+ `message`). Response: `{status, stepsRun, syncedThrough, lastSyncedAt}` in the usual envelope. It is the only write endpoint; it revalidates dashboard pages when steps ran.
- Fixture drives the loop with stubbed steps: fresh, synced, 8-step cap, 45 s cap, busy at start and mid-way, auth_required, error.
- **Not exercised live:** calling it would hit Google and write the shared DB (allowed on the sync path, but it also needs the pushed `api_tokens` table and a token). `runSyncStep` is unchanged and is what the browser's catch-up already uses.
- Verified: `npm run check`.
- By eye / for you: once a token exists, `curl -X POST -H "Authorization: Bearer $TINA_API_TOKEN" localhost:3000/api/v1/sync` should return `fresh` right after a browser sync, and `pending` while a browser sync holds the lock.

## Task 9 — GET /api/v1/schema (commit: see git log --grep "Task 9")
- `src/lib/api/schema-doc.ts` (`SCHEMA_DOC`): conventions, endpoints with params, metric statuses and flags, every unavailable reason, error codes, sync statuses, and a per-field catalogue (`day`, `state`, `sync`) with units and AI-readable prose (what each metric means, how it is estimated, caveats such as the AZM/zone-mapping warning from Task 4). Route `GET /api/v1/schema` requires any valid read token and returns it in the standard envelope.
- Drift guard: `schema-doc.fixture.ts` builds real `buildDayData`/`buildStateData` output (and a `SyncResponseData`), walks every field path, and fails if a returned field is undocumented, a documented non-optional field never appears, or a documented unit disagrees with the data's unit. The reason, error-code, sync-status and flag tables are `Record<ThatUnion, string>` keyed by the real types (`UnavailableReason`, `ApiErrorCode`, `ApiSyncStatus`, `MetricFlag`), so adding a member without prose fails `tsc`.
- Reviewer round (blocking items all fixed): docs now state the real formulas/weights/thresholds (score component weights and caps, cardiac fallback to the daily RHR/HRV score, debt half-life and severity bands, circadian rules, restlessness heuristics, recovery thresholds), the source-efficiency vs totalSleep/timeInBed difference, `partial_day`/`not_supported` as reserved reasons, and catalogues for the envelope, `/days` wrapper and `/schema`. Guard strengthened: a fully scored sample with HR samples (all five breakdown components, an `estimated` metric), unit + primitive-kind + enum-value checks, no forced-optional breakdown fields. Runtime validators live in `src/lib/api/validate.ts` (+ fixture) and are reused by the Task 10 smoke test.
- `SyncResponseData` moved to `src/lib/api/sync-response.ts` so the route and the schema share one type.
- Verified: `npm run check`.

## Task 10 — contract smoke test (commit: see git log --grep "Task 10")
- `scripts/contract-smoke.ts`, last step of `npm run check`. Without `TINA_API_TOKEN` (read from `.env.local` via dotenv, never printed) it prints a loud SKIPPED message and exits 0. Starts nothing; expects `npm run dev` on `TINA_API_URL` (default `http://localhost:3000`). Never calls `/api/v1/sync`; its only database access is read-only SELECTs for the dashboard comparison.
- Calls: schema, state, day (today, yesterday, `2000-01-01`, malformed date), days (7-day, exactly 92 days, 93 days), and the two auth failures (no token, bad token). Every response goes through `validateEnvelope`, `validateMetricShapes` and `validateAgainstDoc` (the same drift guard as Task 9). Asserts: 93 days → HTTP 400 `range_too_large`; `2000-01-01` has an unavailable `sleep.main` and every metric unavailable with a reason, no present value (never a 0); and for 3 recent recorded nights with cached HR samples, the API sleep score equals `assembleDashboardData` fed the dashboard's own queries.
- **Server reachability (reviewer-driven):** with a token set, an unreachable server is a **failure**; only a missing token skips. `TINA_SMOKE_SKIP_UNREACHABLE=1` opts out. It also refuses to send the token over plain http to a non-local host. Caveat: `npm run check` runs `next build` first; if your `next dev` and `next build` clash over `.next`, run the build with dev stopped and the smoke script (`npx tsx scripts/contract-smoke.ts`) afterwards with dev up.
- Reviewer fixes: no silent pass when `days(30)` has the wrong shape; the "never a 0" assertion now checks every metric object is `unavailable` with a reason and no value, plus no plain numeric field on the no-data date; request/JSON failures are recorded as failed checks instead of crashing; 92-day and 30-day responses and the schema's top-level keys are validated too; "insufficient data" is reported distinctly from a score mismatch.
- Score comparison uses only nights with at least 10 cached HR samples (for those the dashboard never needs Google). If fewer than 3 such nights exist in the last 30 days the test fails with that explanation.
- Verified: the skip path (no token), the unreachable-server failure and opt-out, and `npm run check`. **Not run against a live server with a token** — blocked on the `api_tokens` push and a token. Unauthenticated requests to the running dev server already return the correct failure envelope (401 `unauthorized`).
- By eye / for you: after the push + token, run `npx tsx scripts/contract-smoke.ts` with the dev server up and confirm it prints "checks passed".

## Task 11 — zone data honesty (commit: see git log --grep "Task 11")
- **Heart zones:** `src/lib/api/schema-doc.ts` (`heartZoneMinutes.*`) now says Google's per-day Karvonen zones, not Fitbit's fat-burn/cardio/peak; `light` covers most worn time by design. Values stay `measured`.
- **AZM withheld (REVERTED by Task 12c):** enforced in `buildDayData` (`src/lib/api/day.ts`, the `activeZoneMinutes: unavailable("not_supported")` line). The field's type is narrowed to `UnavailableMetric`, so a value cannot be added without a type error. Every consumer goes through `buildDayData`, so `/day` and `/days` both return it. Today's date is withheld too. The two endpoint summaries and the field description in the schema doc say the same.
- **Not touched:** stored zone minutes, `calculateActiveZoneMinutes`, `read.ts`, and the dashboard `azm-trend-card` (it shows the same Karvonen-derived figure the API now returns again; see Task 12c).
- **Guards (withholding assertions replaced by Task 12c):** `contract.fixture.ts` asserts withheld AZM (with all four zone columns populated, and for today) while heart zones stay measured; `contract-smoke.ts` asserts it on every day payload it fetches (day today/yesterday, days(30)).
- **Verified (at the time of Task 11; AZM later restored by Task 12c):** `npm run check` exit 0 with the dev server up (smoke: 436 checks). Read-only against the real DB, `/api/v1/day?date=2026-10-27` and `/days?from=2026-10-26&to=2026-10-27`: AZM unavailable/not_supported with no value; heart zones measured (2026-10-27 light 487, moderate/vigorous/peak 0; 2026-10-26 light 957, others 0), matching the stored rows.
- **Env-load fix (separate commit):** the token scripts failed with "DATABASE_URL missing" because `import` statements run before ordinary code; `scripts/_load-env.ts` is now imported first.

## Task 12 — Real AZM from Google (closed: not a bug)
- Plan written (docs/task-12-azm-plan.md, marked unused). Step 0 and a second probe called `active-zone-minutes` dailyRollUp for 2026-10-17, 10-19..10-27, 09-30 and 11-03 (read-only; raw responses in docs/azm-probe/, no tokens). Result: derived AZM within +-2 min of Google's on all 12 sampled days. No new table, no backfill, no sync change. Details and the corrected Task 4 finding are above.
- Google omits days with no AZM (empty response), it does not return 0.

## Task 12c — revert the Task 11 AZM withholding (commit: see git log --grep "Task 12c")
- `buildDayData` (`src/lib/api/day.ts`) returns `activeZoneMinutes` as `derived` again: `calculateActiveZoneMinutes` over the stored zone minutes, the same call as the dashboard card; today carries `partial_day`; a day with no stored zone minutes is `unavailable` with the usual absence reason.
- Schema doc: computed from Google's per-day Karvonen zone minutes (moderate x1, vigorous/peak x2); matches Google's own AZM within about 2 minutes, not exactly. The two endpoint summaries mention active zone minutes again. The Task 11 `heartZoneMinutes` descriptions are unchanged.
- Fixtures and smoke test now assert derived (non-negative number, unit min) instead of withheld.
