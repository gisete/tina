# Architecture Decisions

Quick reference for re-orienting on this codebase. Invariants that must not be
quietly "fixed" later are called out explicitly.

---

## 1. Read / Sync Split

**The rule:** pages render from DB only. Google is never called on a normal
page load.

| Function | What it does | When called |
|---|---|---|
| `readDashboardData(targetDate?)` | DB reads + analytics assembly | Every page render |
| `syncFromGoogle({ days? })` | Google fetch → normalize → persist → stamp `sync_state` | Sync button, staleness guard (today only), `/api/sync` |
| `loadPageData(targetDate?)` | Staleness guard + `readDashboardData` | All three dashboard pages |

**Staleness guard** (`loadPageData`): fires `syncFromGoogle` only when
`sync_state.last_synced_at` is older than `STALE_AFTER_HOURS = 6` **and**
the view is today (`targetDate` absent or equals `localToday()`).

**Past-date navigation must never trigger a sync.** Browsing June 5 when
today is June 13 renders from cache only. The `isToday` check in
`loadPageData` enforces this — don't remove it.

The one deliberate exception (lazy HR samples) is documented in §3.

---

## 2. The 3-Day Reconcile Window

`syncFromGoogle` fetches only `RECONCILE_WINDOW_DAYS = 3` days back from
Google. This is intentional:

- Google Health v4 only reconciles recent nights; older sessions won't change.
- Full history already lives in Postgres. There is no reason to re-fetch it.
- Consequence: **no automatic path pulls more than 3 days.**

**After a DB wipe / restore**, use the recovery-only backfill:

```
GET /api/sync?days=90
```

The `?days` param exists solely for this. It is not wired into any page load.
Default is 3. Do not pass a wide window from pages.

---

## 3. Lazy HR-Sample Fetch (deliberate read-path exception)

`heart_rate_samples` is a separate intra-night stream (~2.5 Hz, ~11k samples
per 8 h night). It is NOT included in the main sleep sync window because the
volume makes bulk-fetching impractical on every sync.

**`ensureNightSamples(userId, session)`** — the shared helper (in
`src/app/actions/sync.ts`):
- Called from both `readDashboardData` (for the displayed session) and
  `syncFromGoogle` (for the most-recent session).
- If cached count `< MIN_NIGHT_SAMPLES (10)`: fetches from Google, persists,
  returns fresh data.
- If cached count ≥ threshold: returns cache immediately, no Google call.
- At most one Google call per night, ever. Cached permanently after first view.

**Expected behavior:** first visit to any old night is slow (~1-2s extra for
the Google pull). Subsequent visits are instant. This is intentional, not a bug.

**Known gap:** a night never viewed never gets samples. Any future cross-night
aggregate view (30-day overnight-HR trends, cardiac strain history) will have
holes and will need a bulk-backfill path that was deliberately not built. Track
this before building cardiac aggregate charts.

Sample queries key on `session.start_time` / `session.end_time` (timestamps),
not `sleep_date`, so they are unaffected by any historical `sleep_date`
mis-keying.

---

## 4. Date Keying

### sleepDate = "night-of" local date

`sleepDate` is the LOCAL calendar date the night **began** (the evening date,
not the wake-up date). Derived in `normalizers.ts` via:

```ts
nightOf(startTime.getTime(), offsetSeconds)  // offsetSeconds from interval.startUtcOffset
```

`NIGHT_BOUNDARY_HOUR = 18`: if local start time is before 18:00, the session
belongs to the **previous** calendar day. This handles:
- Normal late bedtimes (22:00 local → same date) ✓
- Post-midnight bedtimes (01:06 local → previous date) ✓
- Naps (10:00 local → previous date, but outweighed by main session) ✓

**Never** derive calendar dates from `.toISOString().split("T")[0]` or
`new Date("YYYY-MM-DD")`. Both anchor to UTC midnight and shift the date for
any user not in UTC. This was the root cause of the June 12→13 session being
unreachable when navigating to June 13.

`civilDate()` in `src/lib/google/client.ts` uses UTC date slicing
intentionally — it builds API filter strings where UTC is correct. Leave it.

### Multiple sessions per date (naps)

The unique index on `sleep_sessions` is `(user_id, start_time)`, not
`(user_id, sleep_date)`. Multiple sessions on the same `sleep_date` are valid
(main night + nap).

`selectMainSessions(sessions)` — keeps the session with the largest
`totalSleepMs` per `sleepDate`. Used everywhere analytics run so naps don't
inflate debt or distort variance.

### Query direction

Sessions are stored under the night's START date. A selected day shows the
night the user **woke from** that morning, so session queries for a target date
use `lt(sleepDate, targetDate)` (strictly before). Heart summaries are calendar
days and use `lte`.

---

## 5. Scoring Model

**Holistic Sleep Score** (0–100) — `calculateHolisticSleepScore` in
`src/lib/analytics/sleep/`:

| Component | Weight | Notes |
|---|---|---|
| Volume (total sleep vs target) | 30% | |
| Efficiency | 15% | |
| Deep sleep continuity | 20% | |
| Disruption index | 20% | Lower disruption = higher score |
| Cardiac strain recovery | 15% | Omitted proportionally if absent |

When a component is absent the remaining weights are scaled proportionally.
Designed so a long-but-fragmented night cannot reach 90+.

**Restlessness** is HR-spike-estimated (`detectHrRestlessness`) and labeled
"(est.)" in the UI. Google Health v4 does **not** export Fitbit's
movement-based restlessness — confirmed by API probe. Do not attempt to fetch
it; the field does not exist in the response.

**Sleep debt** is an exponentially-decaying deficit over the last 14 nights:

- `DEBT_WINDOW_DAYS = 14`, `HALF_LIFE_DAYS = 4`, `SURPLUS_EFFICIENCY = 0.5`
- Weight per night: `0.5 ^ (ageDays / 4)` (most-recent nights dominate)
- Surplus recovery is 50% efficient (can't fully repay debt with one long night)
- Output is bounded and recoverable — not a lifetime ledger that grows forever.

---

## 6. Parked / Not Yet Done

- **Persistence-refresh perf**: `onConflictDoUpdate` refreshes stages on
  conflict (delete + re-insert). Fine at current scale; revisit if page loads
  slow down after many re-syncs.
- **`/api/sync` mobile contract**: the JSON envelope (`sleep` + `heart` top-
  level keys) is stable. Future React Native client will need `lastNight`,
  `restlessness`, and `cardiacStrain` added. The `currentState` vs per-night
  split in the payload mirrors the intended mobile contract — don't flatten it.
- **Cross-night cardiac aggregate charts**: blocked on the HR-sample gap noted
  in §3. Need a bulk-backfill loop before building.
