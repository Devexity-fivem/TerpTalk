<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Testing rules

- `npm run test:fast` on every iteration (pure/static, ~10s). `npm run test:master` is the only release gate. `test:slow`/`test:all` add the analytics tier.
- Every suite lives in `scripts/master-tests.mts` with a tier; never add a test script without registering it there.
- Before creating a new test file, add a section to the canonical domain suite listed in README → Testing. New files only for genuinely new domains.
- Source-string (`readFileSync(src)`) assertions only for contracts with no behavioral surface; behavior (auth, privacy, ownership, reputation, parsing, TerpBot) must be exercised via HTTP or the real lib function. No route-mirror queries. No `if (fixture) assert` skips.
- DB suites import `scripts/db-guard.mjs`, clean up everything they create, and keep `Profile.reputation == SUM(ledger)` in fixtures.
- Gate environment: the dev Supabase project (free tier) pauses after ~7 idle days, which shows up as `ENOTFOUND`; restore it from the dashboard. After bumping `playwright-core`, run `npx playwright-core install chromium`, or `browser-tests` fails at launch. A wrapper timeout skips that suite's cleanup, and leaked `__br-*`/`mv_*` fixtures then fail the next run (feed question board, moments residue check). Re-run timed-out suites standalone against `npm run dev`.

# Schema rules

- Every migration that creates a table must include `ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;` — Supabase exposes `public` via its Data API, and `scripts/security-tests.mts` asserts RLS on all public tables.
