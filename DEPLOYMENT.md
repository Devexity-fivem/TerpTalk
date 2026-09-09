# Deployment — Vercel (Hobby) + Neon Postgres

## One-time setup

### 1. Neon (free tier)

1. Create account at https://neon.tech → new project → region closest to your Vercel region
2. Copy the **pooled** connection string (`-pooler` host)
3. (Optional) create a `dev` branch for local development — keep prod/dev separate

### 2. Vercel

```bash
npm i -g vercel
vercel login
vercel          # link the project (first run)
```

### 3. Environment variables (Vercel dashboard → Settings → Environment Variables, or `vercel env add`)

## Required environment variables

Set these in Vercel (Settings → Environment Variables) or `vercel env add`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (`postgresql://…-pooler…?sslmode=require`) for app queries |
| `DIRECT_URL` | (Optional) Neon **direct** non-pooled connection string for running migrations manually |
| `NEXTAUTH_URL` | Production URL (`https://<your-domain>.vercel.app`) |
| `NEXTAUTH_SECRET` | 64-character random hex for JWT signing — **generate a fresh secret for prod** |
| `IP_HASH_SALT` | Random salt for hashing IP addresses (does not need to rotate with every session) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for image uploads |
| `PUSHER_APP_ID` | Pusher app ID |
| `PUSHER_KEY` | Pusher app key |
| `PUSHER_SECRET` | Pusher app secret |
| `PUSHER_CLUSTER` | Pusher cluster, e.g. `us2` |
| `NEXT_PUBLIC_PUSHER_KEY` | Same as `PUSHER_KEY` (public) |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Same as `PUSHER_CLUSTER` (public) |
| `NEXT_PUBLIC_SITE_URL` | Public site URL for sitemap/OpenGraph (`https://<your-domain>.vercel.app`) |

For seeding, you also need:

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Initial administrator account password (single-run) |
| `MOD_PASSWORD` | Initial moderator account password (single-run) |

```bash
# Generate a fresh secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
vercel --prod
```

The `vercel-build` script runs automatically: `prisma generate && next build`.
Migrations are applied manually (avoids Neon advisory-lock timeouts on suspended DBs):

```bash
# After merging a migration, apply it to prod once from your machine:
# Use the direct (non-pooled) Neon URL if available, because the pooled
# pooler does not support Prisma advisory locks.
npx prisma migrate deploy   # or: DIRECT_URL="<direct-url>" npx prisma migrate deploy
```

### 5. Seed the production DB (once, from your machine)

```bash
DATABASE_URL="<neon-url>" ADMIN_PASSWORD="<strong>" MOD_PASSWORD="<strong>" npm run seed
```

Creates admin, moderator, categories, chat rooms, badges, and 10 invite codes (printed once — save them).

## Ongoing

```bash
vercel --prod              # deploy
npm run backup             # local pg_dump (requires pg_dump on PATH)
```

Schema changes: `npx prisma migrate dev` locally against a Neon dev branch → commit → apply migrations manually with `npx prisma migrate deploy` → deploy.

## Rollback

Vercel → Deployments → ⋯ → Redeploy previous. DB: Neon has point-in-time restore on free tier (limited window).
