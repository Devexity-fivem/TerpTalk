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

**Database environments (Neon):** local development and mutation-capable tests use the **`dev`** branch; Vercel Preview deployments also use **`dev`**; Vercel Production uses **`main`**. Never point local tooling at the `main` endpoint.

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `NEXTAUTH_SECRET`, `IP_HASH_SALT`, `NEXTAUTH_URL`. Optional seed: `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `MOD_USERNAME`/`MOD_PASSWORD`. Never commit `.env`.

## Prisma workflow

```bash
npx prisma migrate deploy            # apply migrations to current DATABASE_URL
npx prisma validate && npx prisma generate
npm run seed                         # re-seed categories, chat rooms, optional staff accounts
npm run backup                       # pg_dump or file copy -> backups/
```

Never run `migrate reset` or destructive commands against production. Use `npx prisma migrate dev` only against the Neon `dev` branch.

**Test safety:** every mutation-capable script under `scripts/` imports `db-guard.mjs`, which refuses to run when `DATABASE_URL` resolves to the production endpoint. `ALLOW_PRODUCTION_DB_TESTS=1` overrides it — never set it casually.

**Production migrations (Neon):** `migrate deploy` is not part of the Vercel build — run it manually against the **direct** Neon endpoint, not the `-pooler` URL (PgBouncer transaction pooling breaks the advisory locks Prisma uses). In the Neon dashboard the direct host is the same endpoint minus `-pooler` from the hostname:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@ep-XXXX.us-east-1.aws.neon.tech/neondb?sslmode=require" npx prisma migrate deploy
```

Then push the deploy. App runtime keeps using the pooled `DATABASE_URL`.

**Deployment ordering for schema-dependent changes — migrate BEFORE deploying code.** When a commit both adds a migration and changes code that reads the new columns, this order is required:

1. Create/test the migration locally against `dev`
2. Apply it to production (`migrate deploy`, direct endpoint)
3. Verify with `npx prisma migrate status` → "Database schema is up to date"
4. Push/deploy the application code
5. Smoke-test production

Why it matters: `next build` prerenders pages (e.g. `/diaries`) **against the production database at build time**, and the generated Prisma client already selects the new columns. If code deploys before the migration, the build fails with `P2022: The column ... does not exist` — or worse, runtime 500s on any route touching the new fields. The reverse order is always safe: additive migrations (nullable columns, new indexes) don't break the currently-deployed old code.

## Testing

```bash
npm run lint && npm run build
npm run dev &                        # terminal 1
# open http://localhost:3000 and test key user flows
```

## Deployment workflow

This project uses Vercel with two environments:

- `master` → Production (`https://terp-talk.vercel.app`)
- `pre-prod` → Preview/Pre-production environment for testing before release

```bash
# Start a change
 git checkout -b feature/my-change pre-prod
# ... work, commit, push to pre-prod ...
 git push origin pre-prod
# Vercel builds a preview. Once verified, merge to master:
 git checkout pre-prod
 git pull origin pre-prod
 git checkout master
 git merge pre-prod
 git push origin master
```

Avoid pushing directly to `master` repeatedly. Each `master` build uses Vercel Functions Storage, and failed/skipped builds should be cleaned up from the Vercel dashboard regularly.

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
