# TerpTalk — Final Pre-Launch Production Audit

## Production URL

`https://terp-talk.vercel.app`

## Audit Scope

Static QA, build verification, security surface, dependency check, and code-pattern review. Full end-to-end manual testing of all user journeys was not performed in this pass.

## Build Gate

| Check | Tool | Result |
|---|---|---|
| Production build | `npm run build` | PASS |
| Type checking | Next.js build (Turbopack) | PASS |
| Lint | `npm run lint` | PASS |
| High-severity vulnerabilities | `npm audit --audit-level=high` | 0 found |

## Security — Static Findings

| Area | Result | Notes |
|---|---|---|
| `any` / unsafe casts | None in `src/` | Clean. |
| `@ts-ignore` / `@ts-expect-error` | None in `src/` | Clean. |
| `dangerouslySetInnerHTML` | 4 uses | Layout theme script (hardcoded), JSON-LD (escaped and safe), Markdown `text` (escaped via `escapeForClass`), breadcrumbs (safe JSON-LD). |
| Inline scripts | 1 | `THEME_INIT_SCRIPT` is hardcoded, no user input. |
| Markdown rendering | Reviewed | URLs sanitized to `https?:` or `/`. HTML entities escaped. |
| Public URL references | Correct | `https://terp-talk.vercel.app` used in `sitemap.ts`, `robots.ts`, `lib/seo.ts`, and layout fallbacks. Localhost only appears in `.env.example` (dev template). |
| Secrets in `.env*` | Not committed | `.gitignore` excludes `.env*`. `.env.example` is a template. |
| Auth secret handling | Server-only | `NEXTAUTH_SECRET` is server-side. `publicUserSelect` strips sensitive user fields. |
| Database security | ORM | All access through Prisma; no raw SQL. Password hashes not in public selects. |
| Image upload | Validated | Client resize to ~300 KB, 4-image limit, magic-byte validation, `BLOB_READ_WRITE_TOKEN` server-only. |

## Runtime Error/NAudit Findings

| Issue | Location | Severity | Fix Status |
|---|---|---|---|
| No `vercel.json` security headers | Root | P2 | Fixed — added `vercel.json` with `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`. |
| `dangerouslySetInnerHTML` in `markdown.tsx` for plain text spans | `src/lib/markdown.tsx` | P2 | Mitigated — `escapeForClass` escapes `<`, `>`, `&`. No user input rendered as markup. Acceptable for current scope. |

## Issues Not Found (Clean)

- No hardcoded localhost/HTTP production URLs in runtime code.
- No `@ts-ignore` or `as any` in `src/`.
- No `console.log`/`console.warn` in `src/`; `console.error` limited to server-side catch blocks.
- No high/critical npm vulnerabilities.
- `.env*` files excluded from Git.

## What Could Not Be Verified

The following require live runtime testing and a populated database; they were not exercised in this static audit:

- Full signup/login/logout/session flow.
- Authorization for post/profile/diary edits and admin access.
- Private diary/message boundaries.
- Search edge cases (special characters, Unicode, injection).
- Image upload with malicious payloads.
- Notification and messaging end-to-end behavior.
- Moderation workflows.
- Mobile and dark-mode visual regression.
- PWA installation and service worker.
- Vercel deployment smoke test on the live domain.

## Production Status

**NOT READY FOR PRODUCTION**

The codebase passes build, lint, and static security checks, and the production URL/configuration is correct. However, because the critical user journeys and authorization paths were not verified in a live environment, I cannot certify it as production-ready in this audit. A final runtime QA pass is recommended before declaring launch.

## Next Steps Recommended

1. Deploy `master` to the live Vercel project and run the smoke-test checklist from the original audit (homepage, auth, forum, thread, diary, search, moderation, messaging).
2. Manually test the **Attacker** journey (IDOR, private content, invalid input, oversized uploads).
3. Run Lighthouse/PageSpeed on `https://terp-talk.vercel.app`.
4. Verify the new `pg_trgm` migration and `vercel.json` headers are active in production.
5. Re-run `npm run build` and `npm run lint` after any runtime fixes.
