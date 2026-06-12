<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Code conventions

Follow these when writing new code. They reflect how the codebase is organized today — keep it that way.

## Layering

- **Components render, libraries compute.** Any function with branching, math, or date logic goes in `src/lib/**` as a pure function (plain data in, JSON-safe primitives out, no React/Next/DB imports) so it can be unit-tested with fixture arrays. Components and pages stay thin.
- **Server actions orchestrate only**: auth → fetch → persist → assemble. DB writes live in `src/lib/sync/persist.ts`; payload assembly is pure in `src/lib/sync/assemble.ts`. Don't put business logic in `src/app/actions/`.
- **Analytics engines** (`src/lib/analytics/`): one engine per file, shared types in `types.ts`, re-exported through the module's `index.ts` barrel so import paths stay stable (`@/lib/analytics/sleep`). When two engines share an algorithm (e.g. deep/REM continuity), extract a parameterized core with named threshold constants instead of duplicating.
- **Chart geometry is data, not JSX** — layout math (positions, sizes, ticks) lives in pure modules under `src/lib/charts/`; components only map the returned structures to SVG/DOM.

## Dates & formatting

- Calendar dates are always local-timezone `"YYYY-MM-DD"` via `src/lib/dates.ts` (`localToday`, `parseLocalDate`, `addDays`). **Never** use `Date.prototype.toISOString()` or `new Date("YYYY-MM-DD")` for calendar dates — both anchor to UTC and shift the date by a day around midnight.
- Sleep sessions are keyed by the date the night **started**. A user-selected day shows the night they woke up from that morning, so session queries for a target date use strictly-before (`lt`); calendar-day metrics like heart summaries include the day (`lte`).
- User-facing clock times and durations go through `src/lib/format.ts` (`formatClockTime`, `formatDurationMins`, `formatDurationMs`) — don't inline `toLocaleTimeString` or hand-rolled "Xh Ym" logic.

## TypeScript

- No `any`. Components with per-variant props use discriminated unions and narrow on the discriminant.
- Exported functions declare explicit return interfaces; values crossing the server→client boundary must be plain serializable primitives.

## Database

- Schema lives in `src/db/schema.ts`; apply changes with `npx drizzle-kit push` (this project uses the push workflow). Do **not** run `drizzle-kit migrate` — migration `0000` is a full-schema baseline that would fail against the live DB.
- Uniqueness constraints go in the third `pgTable` argument as a `uniqueIndex`; upserts target them with `onConflictDoUpdate` + `COALESCE` to preserve existing non-null values.

## UI

- Tailwind v4: design tokens are CSS variables in the `@theme` block of `src/app/globals.css` (surface/outline color roles, `--font-display` Epilogue, `--font-sans` Plus Jakarta Sans). Use the token classes (`text-on-surface-variant`, `border-outline-variant`, …) rather than raw palette values for themed surfaces.
- Enter/expand animations use `tw-animate-css` classes (`animate-in fade-in …`), already imported in `globals.css`.

## Verification

- Before considering a change done: `npx tsc --noEmit` and `npm run build` must pass. For logic changes, spot-check the pure functions with a quick `npx tsx` script against realistic fixtures.
