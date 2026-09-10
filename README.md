# TerpTalk

Invite-only cannabis community platform: forums, grow diaries, grow setups, strain database, chat, reactions, blocking, reporting, and full moderation tooling.

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

Requires a PostgreSQL `DATABASE_URL` (local Postgres or a free Neon dev branch). SQLite is no longer supported.

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `NEXTAUTH_SECRET`, `IP_HASH_SALT`, `NEXTAUTH_URL`. Optional seed: `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `MOD_USERNAME`/`MOD_PASSWORD`. Never commit `.env`.

## Prisma workflow

```bash
npx prisma migrate deploy            # apply migrations to current DATABASE_URL
npx prisma validate && npx prisma generate
npm run seed                         # re-seed categories, chat rooms, optional staff accounts
npm run backup                       # pg_dump or file copy -> backups/
```

Never run `migrate reset` or destructive commands against production. Use `npx prisma migrate dev` only against a local dev database.

## Testing

```bash
npm run lint && npm run build
npm run dev &                        # terminal 1
# open http://localhost:3000 and test key user flows
```

## Production documentation

- `DEPLOYMENT.md` — Vercel/Neon deployment and environment setup
- `OPERATIONS.md` — monitoring, backups, migrations, incident response
- `SECURITY.md` — security controls, hardening, and operational guidance
- `PRIVACY.md` — privacy policy and data handling
- `MODERATION_GUIDE.md` — moderator and administrator workflows
- `DEVELOPER_GUIDE.md` — code conventions and contribution notes
- `INCIDENT_RESPONSE.md` — security incident response runbook
- `PRODUCTION_CHECKLIST.md` — pre-launch and post-launch checks

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
