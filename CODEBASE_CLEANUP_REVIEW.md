# Codebase Cleanup Review

## Removed (verified zero references)

- `src/app/forum/thread/[slug]/reply-form.tsx` — duplicate of `components/reply-form.tsx`
- `src/components/reaction-button.tsx` — superseded by `post-actions.tsx`
- `src/lib/utils.ts` — `cn()` unused
- `public/*.svg` — unreferenced Next.js template assets
- `skills-lock.json` — tool artifact

## Dependencies removed (12)

`socket.io`, `socket.io-client`, `@types/socket.io`, `ioredis`, `@types/ioredis`, `react-hook-form`, `@hookform/resolvers`, `zod`, `date-fns`, `class-variance-authority`, `clsx`, `tailwind-merge` — zero imports anywhere. ~43 packages removed from install tree.

## Kept after investigation

| Item | Reason |
|---|---|
| `prisma/migrations-sqlite-archive/` | SQLite migration history — superseded by Postgres baseline; kept as record, Prisma ignores it |
| `.claude/`, `.agents/`, `.windsurf/`, `.devin/` | User's local tool configs — not project code, left untouched |
| `components.json` | shadcn manifest for future components |
| All security/audit `.md` files | Beta audit record; indexed in README |
| `Bookmark`, `Follow`, `DirectMessage`, `DiaryFollow`, `Badge` models | Intentional future features — kept per instructions |
| `scripts/e2e-test.mjs` | Active regression suite |

## Changes made beyond deletion

- `datasource` → `postgresql`; fresh baseline migration `…_init_postgres` (SQLite history archived)
- DB-backed list pages → `export const dynamic = "force-dynamic"` (correct + unbreaks build without DB)
- `.env` → Postgres placeholder; `.env.example` created
- `package.json` → `vercel-build` (generate + migrate deploy + build), `postinstall` (generate), `backup` script
- `.gitignore` → `*.db`, `*.db-journal`, `/backups/`

## Debug artifacts

Only `console.log` found: `scripts/backup.ts`, `scripts/e2e-test.mjs`, `prisma/seed.ts` — all legitimate CLI output. `console.error` in API catch blocks = appropriate server-side error logging, kept. No hardcoded secrets, no auth/captcha/age bypasses, no debug endpoints.

## Not done (intentional)

- No mass renaming or folder restructuring — current layout is conventional and documented
- `ChatSidebar` kept — live polling chat, functional
- No image upload code added — deliberately disabled for beta
