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

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled string — `postgresql://…-pooler…?sslmode=require` |
| `NEXTAUTH_URL` | `https://<your-domain>.vercel.app` |
| `NEXTAUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — **fresh, not the dev value** |
| `IP_HASH_SALT` | fresh generated salt |

### 4. Deploy

```bash
vercel --prod
```

The `vercel-build` script runs automatically: `prisma generate && prisma migrate deploy && next build`.
Migrations are applied at build time against Neon — `migrate deploy` is non-destructive and safe to re-run.

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

Schema changes: `npx prisma migrate dev` locally against a Neon dev branch → commit → deploy (migrate deploy applies automatically).

## Rollback

Vercel → Deployments → ⋯ → Redeploy previous. DB: Neon has point-in-time restore on free tier (limited window).
