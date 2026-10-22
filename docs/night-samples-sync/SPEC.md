# Tina: recent-window sync fetches last night's HR samples

Read AGENTS.md. Use the standard per-phase workflow (single phase).

Context: catch-up removed ensureNightSamples from the sync path entirely. Gap chunks correctly never fetch HR samples, but the recent-window unit used to, via legacy runGoogleSync, so Today's last-night score was complete without visiting the sleep page. Restore that for the recent window only.

- In the sync step's recent-window unit, after all fetches and persists succeed, call ensureNightSamples for the most recent main session (same selection logic legacy runGoogleSync used; show me which code you mirrored).
- A sample-fetch failure must NOT fail the unit, block the cursor, or stamp an error: log a warning and continue (the sleep page's lazy fetch remains the fallback).
- Gap chunks still never call it. Read paths unchanged.
- Gate: tsc, build. Spot-checks: grep shows ensureNightSamples called only from the recent-window branch (plus the legacy path and the lazy read fetch); force one recent step against my real DB and report the heart_rate_samples row count for last night before/after; confirm Today's last-night card no longer shows "partial" (Chrome click-through if connected).
