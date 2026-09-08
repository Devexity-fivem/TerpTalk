# Codebase Cleanup Plan

Audit performed: full traversal of `src/`, `prisma/`, `scripts/`, root config, dependencies, and import graph.

## 1. Files safe to remove

| File | Reason |
|---|---|
| `src/app/forum/thread/[slug]/reply-form.tsx` | Exact duplicate — page imports `@/components/reply-form` |
| `src/components/reaction-button.tsx` | Zero imports; superseded by `post-actions.tsx` |
| `src/lib/utils.ts` | `cn()` helper has zero callers |
| `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | Unreferenced Next.js template assets |
| `skills-lock.json` | Tool artifact, not project code |
| `prisma7.config.ts` | Referenced in history; does not exist — confirmed absent |

## 2. Files kept after investigation

| File | Why kept |
|---|---|
| `src/components/chat-sidebar.tsx` | Used in `layout.tsx` |
| `src/components/update-form.tsx` | Used in `diaries/[id]/page.tsx` |
| `src/components/user-actions.tsx` | Used in `u/[username]/page.tsx` |
| `scripts/e2e-test.mjs` | Active regression suite |
| `scripts/backup.ts` | Active backup tool |
| All `SECURITY_*.md` / `PRIVACY_AUDIT.md` / etc. | Required audit record for beta; consolidated index added to README |
| `.claude/`, `.agents/`, `.windsurf/`, `.devin/` | User's local tool configs — not ours to delete |
| `components.json` | shadcn/ui manifest — kept for future component additions |

## 3. Unused dependencies to remove

| Package | Evidence |
|---|---|
| `socket.io`, `socket.io-client`, `@types/socket.io` | Zero imports; chat is HTTP polling |
| `ioredis`, `@types/ioredis` | Zero imports; rate limiting is DB-backed |
| `react-hook-form`, `@hookform/resolvers` | Zero imports; forms are controlled state |
| `zod` | Zero imports; manual validation is consistent |
| `date-fns` | Zero imports; `toLocaleDateString` used |
| `class-variance-authority` | Zero imports |
| `clsx`, `tailwind-merge` | Only used by the unused `utils.ts` |

## 4. Duplicate functionality

- Reply form existed twice → keep `src/components/reply-form.tsx` only.
- Reaction UI existed twice → keep the like logic inside `post-actions.tsx`.
- Authz helpers already consolidated in `src/lib/security.ts` (`isModerator`, `isAdmin`, `isBanned`, `forbidden`, `unauthorized`, block helpers) — no further abstraction needed.

## 5. Project organization

Current structure is already clean and predictable:

```
src/app/          — routes (App Router conventions)
src/components/   — 8 focused client components
src/lib/          — auth.ts, prisma.ts, rate-limit.ts, security.ts
src/types/        — next-auth.d.ts
prisma/           — schema, migrations, seed
scripts/          — backup, e2e-test
```

No reorganization needed; documented in `ARCHITECTURE.md`.

## 6. Risks

- **SQLite → Postgres**: migrations are provider-specific; a fresh Postgres baseline migration replaces SQLite history (dev.db is disposable; seed recreates it).
- **Prisma 5 + Next 16**: `params` must be awaited — already fixed.
- **Vercel serverless**: DB rate limiter and JWT sessions are serverless-safe; chat polling is stateless. No filesystem state used.
- **Seed**: writes admin/mod credentials — env-driven, prints to console only on dev seed.
