# Tina: move /api/sync?days=N onto the chunked civil-date sync path

Read AGENTS.md. Use the standard per-phase workflow (single phase).

Context: legacy runGoogleSync uses UTC-instant windows (the first day is partial and overwrites complete AZM via EXCLUDED) and fetches zones in one request subject to the 20-page cap (silently truncates for N > ~13). It's now only reachable via /api/sync?days=N.

- Reimplement /api/sync?days=N using the new path: civil-date range (today−N .. today) split with the catch-up chunking, each chunk through syncDateRange (zones in ≤7-day windows), all-or-nothing per chunk, then ensureNightSamples for the most recent main session as in the recent window. Update synced_through only via advanceCursor. Stamp last_synced_at on success.
- Return per-chunk results in the response so failures are visible.
- Delete runGoogleSync and the unused shouldAutoSync flag if nothing else references them (grep and report). Merge the duplicate 6h staleness constants into one.
- Gate: tsc, build. Spot-checks: snapshot daily_activity_summaries for 2026-09-20..2026-10-21, run /api/sync?days=30, re-query, and diff: no day's zone totals may decrease, and 2026-09-21 (the first day) must be unchanged. Report the response body. grep confirms runGoogleSync is gone.
