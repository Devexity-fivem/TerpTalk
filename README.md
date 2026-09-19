# TerpTalk

Public cannabis community platform (21+): forums, grow diaries, grow setups, strain database, chat, reactions, blocking, reporting, and full moderation tooling.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · NextAuth 4 (credentials + JWT) · Prisma 5 · PostgreSQL · Deploys to Vercel (Neon for DB)

## Local development

```bash
npm install          # also runs prisma generate
# copy .env.example -> .env and fill in DATABASE_URL (Postgres), NEXTAUTH_SECRET, IP_HASH_SALT
npx prisma migrate deploy
npm run seed         # categories, chat rooms, optional admin/mod, invite codes
npm run dev          # http://localhost:3000
```

Requires a PostgreSQL `DATABASE_URL`. SQLite is no longer supported.

**Database environments (Neon):** local development and mutation-capable tests use the **`dev`** branch; Vercel Production uses **`main`**. Never point local tooling at the `main` endpoint.

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `NEXTAUTH_SECRET`, `IP_HASH_SALT`, `NEXTAUTH_URL`. Optional seed: `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `MOD_USERNAME`/`MOD_PASSWORD`. Production additionally needs `DATABASE_URL_UNPOOLED` for the migration gate. Never commit `.env`.

## Prisma workflow

```bash
npx prisma migrate deploy            # apply migrations to current DATABASE_URL
npx prisma validate && npx prisma generate
npm run seed                         # re-seed categories, chat rooms, optional staff accounts
npm run backup                       # pg_dump or file copy -> backups/
```

Never run `migrate reset` or destructive commands against production. Use `npx prisma migrate dev` only against the Neon `dev` branch.

**Test safety:** every mutation-capable test/verification script under `scripts/` imports `db-guard.mjs`, which refuses to run when `DATABASE_URL` resolves to the production endpoint. `ALLOW_PRODUCTION_DB_TESTS=1` overrides it — never set it casually.

**Production migrations run inside the Vercel build.** `vercel-build` = `node scripts/prebuild-migrate.mjs && prisma generate && next build`. The gate (`scripts/prebuild-migrate.mjs`):

- Runs **only when `VERCEL_ENV=production`** (or `MIGRATE_ON_BUILD=1`); preview/local builds skip it — a preview can never migrate prod.
- Prefers the **unpooled** connection (`DATABASE_URL_UNPOOLED` → `POSTGRES_URL_NON_POOLING` → `DIRECT_URL` → `DATABASE_URL`) — PgBouncer transaction pooling breaks Prisma's advisory locks.
- Sweeps stale *idle* sessions holding the migrate lock (>60s) before running — leaked sessions once deadlocked deploys.
- Runs `prisma migrate deploy`, retries once, and **exits nonzero on failure** — `next build` never runs, the deployment never promotes, and the previous deployment keeps serving. No code/schema mismatch is possible.

Order is therefore automatic: migrate → verify schema → build → promote. You never run prod migrations manually.

If you ever need a manual migration (disaster recovery), use the **direct** Neon endpoint (same host minus `-pooler`):

```bash
DATABASE_URL="postgresql://USER:PASSWORD@ep-XXXX.us-east-1.aws.neon.tech/neondb?sslmode=require" npx prisma migrate deploy
```

## Testing

```bash
npm run test:master          # authoritative suite — boots a dev server, runs every scripts/*-tests / *-verify against the Neon dev branch
npm run test:<name>          # any single suite (see package.json)
npx tsc --noEmit && npm run lint
```

All mutation-capable test scripts import `scripts/db-guard.mjs`. Content seeds (`prisma/seed.ts`, `scripts/seed-strains.cjs`, `scripts/seed-mars-hydro-products.cjs`) are idempotent upserts and are the only unguarded writers — run them deliberately.

## Deployment workflow

This project uses a single Vercel environment:

- `master` → Production (`https://terp-talk.vercel.app`)

Every push to `master` runs `vercel-build` (migration gate → build → promote). Feature work happens on local branches and lands on `master` via fast-forward/merge once `npm run test:master` passes. Failed/skipped builds can be pruned from the Vercel dashboard.

## Launch checklist

Per deployment — short enough to actually run:

```bash
git status && git rev-parse HEAD          # clean tree, HEAD == origin/master
npm run test:master                       # authoritative suite
npx tsc --noEmit && npm run lint          # types + lint
npm audit --audit-level=high              # 0 expected
git push origin master                    # triggers Vercel
```

Then verify the deploy:

1. `npx vercel ls terp-talk --prod` → newest deployment READY, and the build log shows `[prebuild-migrate]` running before `next build` (or skipping with a reason on non-prod).
2. `curl -s -o /dev/null -w "%{http_code}" https://terp-talk.vercel.app` → 200.
3. Migrations: `npx prisma migrate status` against the prod endpoint → up to date.
4. Smoke: `/auth/signin`, `/forum`, `/chat`, `/notifications` render; TerpBot `/help` answers in chat.
5. Referral sanity: admin → Overview → "Referral Pipeline" — `eligible unpaid` should only list genuinely qualifying referrals.
6. Cron: admin → Overview → "Cron Health" — today's tasks done, `lastRunDate` fresh. If cron dies, the daily digest/tip/sweep silently stop — this card is the tripwire.
7. Rollback: promote the previous READY deployment in the Vercel dashboard (`vercel promote` or Aliases). DB migrations are additive — a code rollback is safe; never `migrate reset` prod.

## Operations notes

- **Cron:** one daily job — `GET /api/cron/terpbot` at 14:00 UTC (`vercel.json`, secured by `CRON_SECRET`). Per-task claims land as `Setting` rows (`<task>:<UTC-date>`); a failed task releases its claim and retries next run. Tasks: digest, grow tip, notification cleanup, dormant-member scan, stale-diary nudges, referral sweep, safety signal scan.
- **Referrals:** signup writes `referredById` + a "joined using your referral link" notification (no instant award). The bonus pays later — once the referee reaches 25 rep and is 24h old — via `payReferralBonus` (keyed `referral:<refereeId>`, weekly cap, legacy unkeyed-payout detection). Both the post-award trigger and the daily `reputation:referral-sweep` cron call the same canonical path.
- **Where to look when prod hurts:** `SecurityEvent` (auth failures, rate limits, registrations, deletions — `metadata.reason` distinguishes causes, `userFound` separates lookup misses from bad passwords), `BotEvent` (TerpBot command/announcement telemetry), `RateLimit` (live throttle keys), `Setting` rows (cron claims), Vercel function logs (everything else — short retention).
- **Key env vars (prod):** `DATABASE_URL` + `DATABASE_URL_UNPOOLED` (Neon main), `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `IP_HASH_SALT`, Pusher set (`PUSHER_*` + `NEXT_PUBLIC_PUSHER_*`), `CRON_SECRET`, `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (signup protection), `BLOB_READ_WRITE_TOKEN` (uploads).

## Project structure

- `src/app/` — App Router routes and API routes
- `src/components/` — shared React components
- `src/lib/` — auth, prisma client, security, rate-limiting, image storage
- `prisma/` — schema, migrations, and seed script
- `public/` — static assets

## Guidelines

- Security checks live server-side in `src/lib/security.ts` — never rely on the client
- Never return raw `User` objects — always use `publicUserSelect`
- Soft-delete content (`deleted` flag); filter it in every listing
- New mutation endpoints require auth + `isBanned` + `rateLimit` + validation
- No `any`, no disabling TS/ESLint, no fake features
