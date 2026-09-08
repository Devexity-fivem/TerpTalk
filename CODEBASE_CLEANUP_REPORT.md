# Codebase Cleanup Report

## Files Removed

**Pass 1 (deploy prep):** 9 files — duplicate `thread/[slug]/reply-form.tsx`, unused `reaction-button.tsx`, unused `lib/utils.ts`, 5 unreferenced template SVGs, `skills-lock.json`. Plus ~200 tool-skill files untracked and gitignored.

**Pass 2 (this pass):** 0 files — no additional dead files found.

## Files Kept (after investigation)

| Item | Why |
|---|---|
| `prisma/migrations-sqlite-archive/` | Historical record of pre-Postgres history; Prisma ignores it |
| `cleanupRateLimits()` in `lib/rate-limit.ts` | Referenced in VERCEL_COST_CONTROL.md as the future cron hook |
| `blockExistsBetween` | Used by `/api/users/[username]` |
| `Bookmark`, `Follow`, `DirectMessage`, `DiaryFollow`, `Badge` models | Intentional future features |
| `components.json` | shadcn manifest for future component additions |
| All audit `.md` docs | Distinct purposes; indexed in README |

## Dead Code Removed (this pass)

- `getBlockRelatedIds()` — exported but never called
- `publicUserSelectWithRole` — exported but never called

## Dependencies Removed

**Pass 1 — 12 direct (~43 installed):** `socket.io`, `socket.io-client`, `ioredis`, `react-hook-form`, `@hookform/resolvers`, `zod`, `date-fns`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@types/socket.io`, `@types/ioredis` — all verified zero imports.

**Pass 2:** none — all remaining dependencies are used.

## Refactoring

- **Consolidated 32 duplicated `401 Unauthorized` responses** across 19 API route files → single `unauthorized()` helper in `lib/security.ts` (codemod + manual fix)
- **Renamed package** `forums` → `terptalk`
- **DB-backed list pages → `force-dynamic`** (correct for fresh community data + unbreaks builds without a live DB)

## Duplicate Code

Already-consolidated infrastructure confirmed: `isModerator`/`isAdmin`/`isBanned`/`forbidden`/`unauthorized`, `publicUserSelect`, `LIMITS`, `rateLimit()`, `logSecurityEvent`, `getClientIp`/`hashIp`. No new abstraction needed.

## Security

All protections preserved and verified: invite gate, server-side 21+, DB captcha, bcrypt, JWT sessions, rate limiting, role separation, ownership checks, `publicUserSelect` data boundary, ban enforcement, soft-delete, security event logging, security headers, export/delete. No security code was removed or weakened.

**Secrets scan: clean.** No secrets in tracked files; `.env` gitignored and never committed.

## Testing

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✓ clean |
| `npm run lint` | ✓ clean (0 errors, 0 warnings) |
| `npx prisma validate` | ✓ valid |
| `npx prisma generate` | ✓ |
| `npm run build` | ✓ 41 routes |
| `npm audit` | ✓ 0 vulnerabilities |
| E2E (`scripts/e2e-test.mjs`) | 54/54 in prior pass; unchanged paths verified — **not re-run** (local DB URL is now the Postgres placeholder until Neon is connected) |

## Remaining Technical Debt

1. **E2E needs a live Postgres URL** to re-run locally (or point at deployed instance)
2. **Chat polling** — DB reads every 3s per chatter; fine for beta, first scaling item
3. **No thread pagination** — all posts load per thread view
4. **`Forum`/`Post` edit history** not retained (overwrites content)
5. **`unauthorized()` consolidation done for 401s; `403` paths partially consolidated** — mixed `forbidden()`/`NextResponse.json` still exist in a few routes
6. **Seed prints generated passwords/invites to console** — acceptable for dev, never run against shared logs in prod
7. **`prisma/migrations-sqlite-archive/`** can be deleted once Postgres history is established and comfortable
