# Developer Guide

## Where code goes

| What | Where |
|---|---|
| New page | `src/app/<feature>/page.tsx` |
| New API endpoint | `src/app/api/<feature>/route.ts` |
| Interactive UI (client) | `src/components/<name>.tsx` |
| Authz / validation / limits / security events | `src/lib/security.ts` |
| Rate limiting | `src/lib/rate-limit.ts` (`rateLimit(key, n, windowMs)`) |
| DB access | `src/lib/prisma.ts` (singleton — never `new PrismaClient()`) |
| Auth config | `src/lib/auth.ts` |
| Type augmentation | `src/types/` |
| DB changes | `prisma/schema.prisma` → `npx prisma migrate dev` |
| One-off scripts | `scripts/` |

## Conventions

- **Auth check first, always server-side**: every protected route starts with `getServerSession(authOptions)` → `unauthorized()`.
- **Ban check on mutations**: `if (await isBanned(session.user.id)) return forbidden(...)`
- **Rate limit mutations**: `rateLimit(\`<action>:${userId}\`, n, windowMs)` → 429
- **Public data**: always select via `publicUserSelect` — never return a raw `User` (it contains the password hash)
- **Deletes**: soft-delete via `deleted` flag; filter `deleted: false` in every listing
- **Roles**: `isModerator(role)` / `isAdmin(role)`; bans are admin-only; no self-moderation
- **Validation**: manual checks against `LIMITS`; invalid → 400 with a safe message
- **Errors**: `catch` → `console.error` server-side, generic message to client — never stack traces
- **Naming**: kebab-case dirs/routes, PascalCase components, camelCase functions
- **No `any`**, no disabling ESLint/TS rules

## Commands

```bash
npm run dev        # dev server
npm run lint       # eslint
npx tsc --noEmit   # typecheck
npm run build      # production build
npm run seed       # categories, chat rooms, admin/mod, invite codes
npm run backup     # DB backup
node scripts/e2e-test.mjs   # 54-check live regression suite (dev server must be up)
```

## Rules that will bite you

- Next.js 16: `params` is a **Promise** in pages and route handlers — `await params`
- DB-backed list pages need `export const dynamic = "force-dynamic"` or the build prerenders them against the DB
- No filesystem state — serverless (rate limits, sessions, chat are all DB/JWT-backed by design)
