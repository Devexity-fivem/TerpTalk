# TerpTalk

Invite-only cannabis community platform: forums, grow diaries, grow setups, strain database, chat, reactions, blocking, reporting, and full moderation tooling.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · NextAuth 4 (credentials + JWT) · Prisma 5 · PostgreSQL · Deploys to Vercel (Neon for DB)

## Local development

```bash
npm install          # also runs prisma generate
# copy .env.example → .env and fill in DATABASE_URL (Postgres), NEXTAUTH_SECRET, IP_HASH_SALT
npx prisma migrate dev
npm run seed         # categories, chat rooms, admin/mod, 10 invite codes
npm run dev          # http://localhost:3000
```

Requires a PostgreSQL `DATABASE_URL` (local Postgres or a free Neon dev branch). SQLite is no longer supported.

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `NEXTAUTH_SECRET`, `IP_HASH_SALT`, `NEXTAUTH_URL`. Seed-only: `ADMIN_*`, `MOD_*`. Never commit `.env`.

## Prisma workflow

```bash
npx prisma migrate dev --name <change>   # local schema change
npx prisma validate && npx prisma generate
npm run backup                           # pg_dump or file copy → backups/
```

Never run `migrate reset` or destructive commands against production.

## Testing

```bash
npm run lint && npm run build
npm run dev &                            # terminal 1
node scripts/e2e-test.mjs                # terminal 2 — 54-check E2E suite
```

## Deployment

See `DEPLOYMENT.md` — Vercel runs `prisma generate && prisma migrate deploy && next build` automatically.

## Project structure

See `ARCHITECTURE.md`. Short version: `src/app/` routes, `src/components/` client components, `src/lib/` auth/prisma/security/rate-limit, `prisma/` schema + migrations + seed.

## Beta docs

`SOFT_LAUNCH_READINESS.md` · `BETA_TEST_PLAN.md` · `BETA_LAUNCH_CHECKLIST.md` · `MODERATION_GUIDE.md` · `SECURITY_REGRESSION_TESTS.md` · `VERCEL_COST_CONTROL.md` — plus the audit set (`SECURITY_*`, `PRIVACY_*`, `THREAT_MODEL`, `DATA_INVENTORY`, `INCIDENT_RESPONSE`, `PRODUCTION_CHECKLIST`).

## Guidelines

- Security checks live server-side in `src/lib/security.ts` — never rely on the client
- Never return raw `User` objects — always `publicUserSelect`
- Soft-delete content (`deleted` flag); filter it in every listing
- New mutation endpoints: auth + `isBanned` + `rateLimit` + validation
- No `any`, no disabling TS/ESLint, no fake features
