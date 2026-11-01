# TerpTalk Pre-Launch Audit — 2026-11-01

**Scope:** post-cutover comprehensive review — security, dependencies, bug patterns, maintainability — ahead of advertising push.
**Baseline:** `dev`/`master` at `d62b063` + this change set (next 16.4.3 bump). Production verified live on Supabase `terptalk-db`.
**Method:** automated sweeps (all 123 API routes grepped for guard vocabulary, raw-SQL interpolation scan, dangerous-pattern scan) + targeted manual review of high-risk surfaces + `npm audit`/`outdated`/lint/tsc/test gates.

## Verdict

**Launch-safe.** No exploitable defect found in application code. Auth surface is complete, XSS/SQLi surfaces are correctly defended, cron is fail-closed, the critical Next.js advisory is patched, and the codebase is genuinely clean (0 lint errors, 0 TODO/FIXME debt markers, consistent tt-* design system). Remaining items are transitive dependency debt and cosmetic lint noise.

## Findings

| # | Sev | Status | Finding |
|---|-----|--------|---------|
| F-01 | CRITICAL | **FIXED** | `next` 16.0.0–16.4.0 advisory → bumped to 16.4.3 + react/react-dom 19.3.1 + eslint-config-next 16.4.3 |
| F-02 | HIGH | ACCEPTED-DEBT | `zod@4.1.11` (<4.6.6) pinned inside `@vercel/cli-config@0.3.1` ← `@vercel/oidc@3.8.10` ← `@vercel/blob@2.8.2` (already latest). Only reachable via blob OIDC token exchange, not request paths. No upstream fix yet — monitor `@vercel/oidc` 4.x adoption |
| F-03 | MEDIUM | ACCEPTED-DEBT | `minimatch` glob-DoS inside eslint-config-next's eslint plugin chain (dev-only, never ships to prod). `npm audit fix --force` would downgrade eslint to v4 — do NOT run |
| F-04 | LOW | NOTE | 1,211 lint warnings ≈ all confined to `scripts/*-verify.mjs` assertion style (`no-unused-expressions`) + 2 `<img>` (admin/media, profile/complete). Zero warnings in `src/` app code paths beyond the 2 img tags |
| F-05 | LOW | NOTE | `escapeForClass()` in `src/lib/markdown.tsx` is actually a correct HTML escaper (`&` `<` `>`); the name misleads — rename to `escapeHtml` on next touch |
| F-06 | INFO | — | Large-file watchlist for future refactors: `terpbot-intel.ts` (3,739), `terpbot-data.ts` (1,987), `profile-client.tsx` (1,839), `progression.ts` (1,607), `chat-room.tsx` (1,570) |

## Verified-clean surfaces

- **Route guards:** all 123 API routes — admin/moderator paths use `requireAdmin`/`requireModerator`/`requireStaff` (+ rate limiting); the only unguarded routes are intentional public GETs (`/api/categories`, `/api/forum/updates` cached, `/api/settings/announcement`).
- **Injection:** zero interpolated `$queryRawUnsafe` — every raw query is parameterized.
- **XSS:** custom markdown renderer escapes text tokens and sanitizes hrefs (protocol-relative/backslash cases regression-tested); `dangerouslySetInnerHTML` elsewhere is JSON-LD structured data only.
- **Cron:** `CRON_SECRET` fail-closed in prod + forge-proof bearer check + new CT-window gate; day-scoped claims make the dual UTC entries idempotent.
- **Sessions/roles/uploads/links/captcha/markdown:** covered by `security-tests.mts` behavioral suite (tier full).
- **Progression/reputation:** ledger-based with reversal outbox, drift checks, rep-velocity anti-abuse fix (`ba30faa`) now deployed.

## Version posture

Current (installed): next 16.4.3, react 19.3.1, prisma 6.19.3, typescript 5.9.3, next-auth 4.24.15, node 22.
Deferred majors (real migrations, not safe to rush): **prisma 7**, **typescript 7**, **next-auth→Auth.js v5**, @types/node 26. Track as roadmap items with dedicated test cycles — none are security-urgent today.
Cheap patch bumps worth scheduling: `lucide-react` 1.55→1.66, `emoji-picker-react` →5.1.4, `bip39` →3.1.2, `playwright-core` →1.64.1.

## Comment/maintainability coverage

The codebase is already unusually well-commented at module level — `cron-claim.ts`, `terpbot.ts`, `markdown.tsx`, `require-staff.ts`, `reputation.ts` all carry "why" comments on the non-obvious invariants (claim semantics, sanitization edge cases, anti-abuse rationale). Gaps for future-dev onboarding: per-function docs are thin inside the five largest files (F-06) and inside `src/app/api/*` route handlers that encode domain rules (diary visibility, contest resolution, quest payout reconciliation). Recommend a targeted comment pass on those files rather than repo-wide churn — see F-06 list as the queue.

## Recommended next batch

1. Ship this dep bump (next 16.4.3) to prod — in this commit set.
2. Batch the cheap patch bumps (lucide, emoji-picker, bip39, playwright).
3. One dedicated comment/docstring pass on the F-06 files before onboarding new devs.
4. Schedule prisma 7 + next-auth v5 migrations as separate projects.
