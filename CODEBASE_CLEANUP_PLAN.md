# Codebase Cleanup Plan — Pass 2 (Maintainability)

Pass 1 (deploy prep) already removed: duplicate reply-form, unused reaction-button, `utils.ts`, template SVGs, `skills-lock.json`, 12 unused dependencies, tool-skill dirs from git. This pass covers what remains.

## Audit findings (current state)

### Dead code
| Item | Evidence | Action |
|---|---|---|
| `getBlockRelatedIds` (security.ts:37) | Zero call sites | Remove |
| `publicUserSelectWithRole` (security.ts:80) | Zero call sites | Remove |
| `prisma/migrations-sqlite-archive/` | Superseded by Postgres baseline | Keep — documented history, harmless |

### Duplication to consolidate
| Pattern | Occurrences | Action |
|---|---|---|
| `NextResponse.json({ error: "Unauthorized" }, { status: 401 })` | 32 sites, ~18 route files | Replace with existing `unauthorized()` helper |

### Naming / metadata
- `package.json` name is `forums` → rename to `terptalk`
- Directory + file naming is otherwise consistent (kebab-case routes, PascalCase components)

### Verified clean already
- No secrets in tracked files (`.env` gitignored, never committed)
- No `any` types in `src/`
- All `console.*` calls are legitimate `console.error` server-side error logging — kept intentionally
- ESLint clean, no unused imports
- `cleanupRateLimits()` kept — referenced in VERCEL_COST_CONTROL.md as the future cron hook
- `blockExistsBetween` IS used (`/api/users/[username]`) — kept
- Future-feature Prisma models (Bookmark, Follow, DirectMessage, Badge, DiaryFollow) — kept intentionally

### Documentation
- Keep all audit/beta docs — they serve distinct purposes
- Create `DEVELOPER_GUIDE.md` (conventions + where code goes)
- `ARCHITECTURE.md` already exists — refresh if needed

## Risks
- `unauthorized()` consolidation is mechanical; risk = missed import. Mitigation: lint + tsc + build after.
- No functional changes intended; E2E suite re-run to confirm.
