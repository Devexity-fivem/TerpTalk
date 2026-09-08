# TerpTalk Architecture

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind 4 · NextAuth 4 (credentials + JWT) · Prisma 5 · PostgreSQL · Vercel (serverless)

## Request flow

```
Browser → Next.js pages (RSC + client components)
        → /api/* route handlers (server-side auth + validation + rate limit)
        → src/lib/prisma.ts (singleton PrismaClient)
        → PostgreSQL (Neon pooled connection)
```

## Directory layout

```
src/app/                  Routes — one folder per feature
  api/                    Route handlers (REST JSON)
  forum/ diaries/ setups/ strains/ feed/  Content areas
  auth/                   signin, signup (invite-gated)
  profile/ u/[username]/  Private + public profiles
  moderation/ admin/ notifications/       Staff + user tools
src/components/           Client components (one per responsibility)
src/lib/                  auth.ts, prisma.ts, rate-limit.ts, security.ts
src/types/                next-auth.d.ts (session augmentation)
prisma/                   schema.prisma, migrations/, seed.ts
scripts/                  backup.ts, e2e-test.mjs
```

## Security model (all server-side)

- **Auth**: NextAuth credentials → bcrypt compare → JWT (7-day, HTTP-only). Banned users rejected at login AND every mutation.
- **Roles**: MEMBER < MODERATOR < ADMINISTRATOR via `isModerator`/`isAdmin` in `lib/security.ts`.
- **Authorization**: ownership checks on edit/delete; moderator override; admin-only bans/invites.
- **Rate limiting**: DB-backed `rateLimit()` — works across serverless instances.
- **Data boundary**: `publicUserSelect` — no password/email in any response. E2E-tested.
- **Audit**: `SecurityEvent` model, salted IP hashes, moderation action log.
- **Headers**: CSP, HSTS, frame-deny, nosniff in `next.config.ts`.

## Forum data model

`Category → Thread → Post → Reaction`. Threads and posts are soft-deleted (`deleted` flag) and filtered from every listing. `locked` threads reject replies. Thread slugs are unique; CUIDs for IDs.

## Chat

HTTP polling (3s) — stateless, serverless-safe. Rooms seeded; messages soft-deleted; rate-limited 30/min. Realtime upgrade path: Socket.io + Redis adapter (documented future work — removed unused deps).

## Invite-only beta

`BetaInvite` codes are single-use, generated on `/admin` or by seed. Registration validates code + captcha + age server-side; the invite is burned on success.

## Where new features go

- New page → `src/app/<feature>/page.tsx` + `src/app/api/<feature>/route.ts`
- New interactive widget → `src/components/<name>.tsx`
- Shared authz/validation → `src/lib/security.ts`
- New data → `prisma/schema.prisma` + `npx prisma migrate dev`
