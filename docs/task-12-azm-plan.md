# Task 12 — AZM fix plan (PLAN ONLY, awaiting approval, no code written)

> **NOT USED.** Task 12 was closed as not a bug: the probes (docs/azm-probe/) showed the derived AZM matches Google's own active-zone-minutes within ±2 min on all 12 sampled days. No table, backfill or sync change was made. Kept for the record only.

## Evidence base (read this first)
There is **no `docs/azm-probe/`**. Task 4 never ran a probe: it stayed blocked on approval for a Google call outside the sync path, so its findings come from code, Google's published reference and stored data. Everything below about the Google response is therefore from documentation, **not** a raw sample. Step 0 below closes that gap before any code is written.

## 1. Which Google data type
`active-zone-minutes`, read with `POST /v4/users/me/dataTypes/active-zone-minutes/dataPoints:dailyRollUp` (`windowSizeDays: 1`). Per Google's reference it returns, per civil day, `sumInFatBurnHeartZone`, `sumInCardioHeartZone` and `sumInPeakHeartZone` (int64 strings), i.e. Fitbit's own zones, not the Karvonen `time-in-heart-rate-zone` type used today. Limits: 90 days maximum per query; 1-minute resolution; no retention cutoff stated ("as far back as it has been recorded").

Unconfirmed (hence Step 0): whether those sums are already AZM-weighted (cardio/peak counted 2x) or raw minutes, and whether days with no AZM come back as 0 or are omitted. Total AZM must equal the Fitbit app's number for a day where the app shows AZM > 0; if the sums are raw minutes the total is fat-burn + 2 x cardio + 2 x peak (the same 1x/2x/2x weights already in `ZONE_AZM_WEIGHT`, now applied to the right zones).

## 2. Step 0 (needs your OK): one raw sample
A one-off read-only script calls `dailyRollUp` for 2026-10-17 (steps 21,450; the highest stored moderate day) and 2026-10-27, and prints the raw JSON. It is a Google call outside the sync path and may refresh the OAuth token (a write to `account`). I would compare the total with what the Fitbit app showed for 2026-10-17 before going further. If it does not match, the plan stops and comes back to you.

## 3. Storage (new table, nothing existing altered)
A new table `daily_active_zone_minutes (user_id, activity_date, fat_burn_minutes, cardio_minutes, peak_minutes, fetched_at)` with a unique index on (user_id, activity_date). A brand-new table is allowed without a stop, but it still needs your `drizzle-kit push`. `daily_activity_summaries` and its stored Karvonen zone minutes are **not modified or rewritten**: `heartZoneMinutes` keeps reading them.

## 4. How many days get rewritten
**Zero existing rows are rewritten**, because the AZM numbers go in the new table. The backfill inserts up to ~228 rows (2026-03-21, the earliest stored activity day, to today; 218 rows exist in `daily_activity_summaries` today, covering fewer days than the calendar span). Going forward, the existing recent window (today - 3 .. today) upserts its rows; those days are overwritten by the fresh fetch, as zone minutes are today, because Google can revise recent days.

## 5. Google calls outside the normal 3-day sync
Yes, once. The normal sync only reaches back 3 days (plus gap chunks of 14 days when `synced_through` lags), so it cannot fill 228 days of history. The plan:
- **Ongoing:** `dailyRollUp` becomes one more fetch inside the existing sync step, over the same date range that step already handles. This adds a Google call **inside** the sync path (allowed by the working rules, but a change you should know about): one extra request per sync unit.
- **One-off backfill:** a script modelled on `scripts/backfill-activity-zones.ts` (idempotent, paced), covering 2026-03-21 to today in 90-day windows = 3 requests (or 14-day windows = about 17, if you prefer to match the sync chunks). This is outside the sync path, so it only runs on your explicit go-ahead and only after the `push`.

## 6. Days Google no longer returns
Never deleted and never zero-filled. If a day is absent from the response: no row is written, and a previously stored row for that day is **kept** (a missing response is not evidence the value changed). In the API, a day with no AZM row stays `unavailable`: `not_synced` after the sync cursor, `not_fetched` for covered days that were not backfilled or Google omitted. A day Google returns with an explicit 0 is `measured` 0. If Step 0 shows Google returns 0 for days it simply has no AZM for, I will tell you before choosing between those two readings.

## 7. API and doc changes
`activeZoneMinutes` changes from always `unavailable / not_supported` to `measured` (today carries `partial_day`), unit `min`, read from the new table; the schema doc and fixtures change with it, and the Task 11 withholding assertions are replaced, not deleted. `heartZoneMinutes` is unchanged. Optional: expose the three Fitbit-zone breakdowns as separate measured fields (your call; default is the total only).

## 8. What this needs from you
1. OK to run the Step 0 raw sample (Google call outside the sync path, possible token refresh write).
2. OK for the new table and `npx drizzle-kit push` after Step 0 confirms the numbers.
3. OK for the backfill run, and the window size (3 x 90-day vs about 17 x 14-day requests).
4. Decision outside this task's scope: the dashboard `azm-trend-card` still shows the Karvonen-derived figure. Switching it is UI work (out of scope for this plan); until then the dashboard and the API will disagree, with the API being the honest one.
5. Tell me if you want the last-synced AZM total in `/api/v1/state` too (default: no).
