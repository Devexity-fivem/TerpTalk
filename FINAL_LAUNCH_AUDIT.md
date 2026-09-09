# TerpTalk Final Pre-Launch Security & Privacy Audit

## 1. Executive summary

This audit treated TerpTalk as a public forum expected to support thousands or tens of thousands of users and assumed active malicious behavior. The objective was to find **and fix** problems across the frontend, backend, database, authentication, authorization, moderation, messaging, search, notifications, uploads, deployment, and operational controls.

**Final decision: GO** for a controlled public soft-launch, with the residual risks documented below and owned by follow-up work.

## 2. Overall security assessment

Security posture is **strong** for a username-only, server-side-rendered Next.js application.

- Authentication uses bcrypt (cost 12), JWT HTTP-only `__Host-` cookies, session freshness checks, and `sessionVersion` invalidation.
- Authorization relies on fresh DB role/ban lookups, not stale JWT claims, for every mutation and staff endpoint.
- Rate limiting is database-backed and applied to auth, posting, messaging, search, uploads, and staff actions.
- IDOR is mitigated by per-resource ownership checks and CUID identifiers.
- XSS is prevented by React text-node rendering, JSON-LD escaping, and a restrictive CSP (with one deliberate relaxation for images).
- Uploads are verified by declared MIME type, magic bytes, SVG rejection, and size caps.

## 3. Overall privacy assessment

Privacy posture is **strong** by design.

- No email field exists in the schema; username-only identity is enforced.
- Raw IPs are never persisted; only SHA-256-hashed IP values are stored.
- Security-event metadata is sanitized and limited to safe identifiers.
- Public DTOs no longer expose business names, locations, or other profile PII by default.
- Account deletion requires password + typed username and cascades user-owned content.

Known privacy gaps: uploaded images are stored as public Vercel Blob objects and retain EXIF metadata server-side; public image URLs may be shared or scraped. This is a residual risk suitable for a soft launch.

## 4. Reliability and scalability assessment

- The schema uses soft deletes, counts, and indexes (`Thread_replyCount_idx`, `sessionVersion`).
- The application builds cleanly, validates against Prisma, and `npm audit` reports zero vulnerabilities.
- Database-backed rate limiting works across serverless instances but adds write load; extremely high abuse could still stress the DB.
- Real-time chat falls back to HTTP polling and is gated by Pusher auth.
- `vercel-build` applies migrations automatically.

## 5. Findings and fixes

| Severity | Area | Finding | Fix | Affected files |
|---|---|---|---|---|
| Critical | Auth | Per-IP login throttling missing | Added per-IP throttling keyed by `hashIp(getClientIp(...))` | `src/lib/auth.ts` |
| Critical | Auth | `getClientIp` trusted left-most `X-Forwarded-For` | Prefers platform headers and uses right-most forwarded value | `src/lib/security.ts` |
| Critical | Profile | PATCH `null`-ed omitted fields | Rewrote PATCH to conditionally update only supplied fields | `src/app/api/profile/route.ts` |
| High | Forum | Hidden categories leaked in reads and writes | Filtered `deleted`/`hidden` in threads, posts, search, similar, bookmarks, follows, updates, profiles | `src/app/api/forum/*`, `src/app/api/search/route.ts`, `src/app/api/bookmarks/route.ts`, `src/app/api/users/[username]/route.ts` |
| High | Forum | Reactions/bookmarks/follows could target deleted or missing content | Added existence + deleted + hidden + ban checks before creation | `src/app/api/reactions/route.ts`, `src/app/api/bookmarks/route.ts`, `src/app/api/follows/route.ts`, `src/app/api/categories/follow/route.ts` |
| High | Moderation | Role information leaked in error messages | Replaced specific role messages with generic authorization errors | `src/app/api/moderation/actions/route.ts` |
| High | Search | Wildcard characters and hidden categories not handled | Escape `_%` in `contains` searches and filter hidden/deleted | `src/app/api/search/route.ts` |
| Medium | Privacy | `publicUserSelect` exposed `businessName/businessType/businessUrl` | Removed business fields from public author selector | `src/lib/security.ts` |
| Medium | Privacy | Public profiles exposed internal `id`, exact location, grow details | Built a DTO returning only safe public fields; kept `id`/`role` for UI badges only | `src/app/api/users/[username]/route.ts` |
| Medium | Images | `storeImage` fell back to data URI in production | Throws when Blob is unconfigured; rejects invalid/non-image payloads | `src/lib/blob.ts` |
| Medium | Images | Image upload happened before auth/rate/ban checks | Moved image processing after session, validation, rate limit, and ban checks | `src/app/api/profile/route.ts`, `src/app/api/diaries/updates/route.ts`, `src/app/api/contest/route.ts` |
| Medium | DMs | Direct-message responses exposed full Prisma objects | Returned `senderDto` for message lists | `src/app/api/messages/route.ts` |
| Medium | Chat | Pusher payload and response returned raw objects | Added `messageDto` and rate limit on Pusher auth | `src/app/api/chat/messages/route.ts`, `src/app/api/pusher/auth/route.ts` |
| Medium | Security | Raw IPs used in rate-limit keys | Hashed IPs with `hashIp` for search, similar threads, and chat rooms | `src/app/api/search/route.ts`, `src/app/api/forum/threads/similar/route.ts`, `src/app/api/chat/rooms/route.ts` |
| Medium | Errors | Many mutation endpoints lacked `try/catch` and ban checks | Wrapped handlers, added `isBanned` and rate limiting | Many `src/app/api/*` routes |
| Medium | Validation | `console.error` and malformed JSON fallback patterns | JSON parse failures now return 400; `console.error` retained only for server logs | Many `src/app/api/*` routes |
| Medium | CSP | `X-XSS-Protection` header was `1; mode=block`; `img-src https:` broad | Disabled `X-XSS-Protection`, added `frame-src`/`object-src`, kept `https:` with note | `next.config.ts` |
| Low | Schema | Unsafe unconditional `DROP INDEX` in historical migration | Changed to `DROP INDEX IF EXISTS` | `prisma/migrations/20260920162823_add_message_comment_notifications/migration.sql` |
| Low | Migrations | Temporary `_rename_migration.sql` in repo | Deleted | `prisma/migrations/_rename_migration.sql` |
| Low | JSON-LD | No escaping of U+2028/U+2029 | Added safe JSON-LD serializer | `src/components/json-ld.tsx`, `src/components/breadcrumbs.tsx` |
| Low | Admin | Search `q` parameter used as `contains` pattern | Escape LIKE wildcards in admin user search | `src/app/api/admin/users/route.ts` |

## 6. Remaining risks / launch blockers

The following items are **not blockers** for a soft launch but should be prioritized post-launch:

1. **Bot protection**: the built-in arithmetic CAPTCHA slows but does not stop automated abuse. Add Cloudflare Turnstile or reCAPTCHA at high-abuse periods.
2. **Image CSP and EXIF**: `img-src 'self' data: blob: https:` is broader than ideal; uploaded images are not stripped of EXIF. Either proxy/process images or switch to a strict allow-list and strip metadata.
3. **Rate-limit write pressure**: database-backed rate limits work but generate `RateLimit` writes. Move to Redis or an in-memory store if request volume grows.
4. **Admin/affiliate DTOs**: admin endpoints still return raw Prisma objects for affiliates and some stats. These are staff-only but should be DTO-mapped to reduce accidental exposure.
5. **Public profile `id`/`role`**: internal `User.id` and `role` still appear in public author objects because the UI renders `RoleBadge`. Evaluate whether `role` badges are strictly necessary or replace with a derived `trustLevel`/`isStaff` boolean.
6. **Email/notification abuse**: notification `createMany` paths could be used to send many pings. Current rate limits help, but notification per-user caps could be added.
7. **Pusher public room**: public chat is open to all authenticated users; private rooms require moderator role. If membership models evolve, enforce per-room membership.
8. **Automated security testing**: no dynamic pentest or fuzz test was run; consider a follow-up OWASP ZAP/burpsuite pass and dependency scanning in CI.

## 7. Verification results

All verification commands were run on the final tree and passed:

```bash
npm run lint              # PASS
npx tsc --noEmit          # PASS
npm run build             # PASS
npx prisma validate       # PASS
npx prisma migrate status # PASS
node scripts/verify-security.cjs  # 115 passed, 0 failed
npm audit                 # 0 vulnerabilities
```

Additional checks:

- Repository secret scan: no tracked `.env`, keys, or tokens in `src/`.
- Temporary/debug scan: no `.tmp`, `.log`, `.bak`, or `todo` files.
- Obsolete migration artifact removed.
- `SECURITY.md`, `PRIVACY.md`, `OPERATIONS.md`, and `DEPLOYMENT.md` updated.

## 8. GO / NO-GO decision

**GO** — The application is ready for a controlled public soft launch on Vercel + Neon with the documented residual risks. Continue to monitor `SecurityEvent` logs, rate-limit hit rates, and moderation queues in the first weeks. Address residual risks as the user base grows.
