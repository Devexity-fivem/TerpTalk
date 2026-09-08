# TerpTalk Soft Launch Readiness

**Date:** 2026-09-08 · **Mode:** Invite-only beta · **Verified by:** Live E2E test (54 checks)

## GREEN — Ready for beta

Verified working via automated E2E (all passed against live dev server):

- **Registration** — invite code required (server-validated, single-use), 21+ enforced server-side, DB captcha (single-use, 5-min expiry), username rules + reserved names, duplicate rejection
- **Login/logout** — credentials auth, bcrypt, wrong-password rejection, uniform errors (no enumeration), login rate limit (10/15min)
- **Sessions** — JWT, 7-day expiry, HTTP-only cookies
- **Forums** — categories load from DB, thread create/view/reply, edit own post, delete own post/thread, reactions with type allowlist, breadcrumbs, empty states, locked/deleted states
- **Data exposure** — no password/email anywhere in API responses or RSC payloads (`publicUserSelect` verified by test)
- **Blocking** — block/unblock API, blocks are private, blocked user gets 404 on blocker's profile, follows removed on block
- **Reporting** — report threads/posts/chat/profiles/diaries/setups, 7 reason categories, duplicate-report prevention, reporter confirmation, mod notifications
- **Moderation** — `/moderation` queue (view reports, remove content, resolve/dismiss), moderation log, MODERATOR can't ban or touch admins/mods, self-action blocked
- **Admin** — `/admin` dashboard (user/content/report stats, security events 24h), invite generation, role separation enforced (403 for mods on admin endpoints)
- **Rate limiting** — DB-backed (survives restarts): register 5/15min, login 10/15min, threads 10/hr, posts 30/10min, chat 30/min, reactions 120/10min, reports 10/hr, blocks 30/hr
- **Bans** — `banned` flag enforced at login AND on all content-creation endpoints
- **Account deletion** — typed-username confirmation, cascades all content; data export (JSON) works
- **Security logging** — SecurityEvent model; IPs salted-hashed; no passwords/tokens/content logged
- **Headers** — CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy
- **Deleted content** — filtered from all listings; direct access returns 404
- **Notifications** — created on replies + moderation actions, `/notifications` page, unread badge
- **Backups** — `npm run backup` (SQLite file copy / pg_dump for Postgres), 30-day retention, restore verified (valid SQLite file)
- **Dependencies** — `npm audit`: 0 vulnerabilities

## YELLOW — Known limitations (acceptable for beta)

| Limitation | Impact | Plan |
|---|---|---|
| Chat uses 3s HTTP polling, not realtime | Works but higher server load; slight delay | Socket.io post-beta |
| SQLite database | Fine for small controlled beta; won't scale past ~50 concurrent | Migrate to Postgres before scaling |
| No password reset | Users locked out must contact admin | Implement email flow post-beta |
| No image uploads | Diaries/setups are text-only | Build with EXIF stripping + AV scan |
| No DMs | Feature absent, not broken | Post-beta |
| Follow UI absent | Follow model exists, blocks clear follows | Post-beta |
| No thread pagination | Long threads load all posts | Add pagination post-beta |
| Rate limits are per-user/IP | Shared IPs (offices/NAT) could hit limits | Monitor and tune |
| `dev.db` contains test users from E2E | Clean before launch | Reset DB or prune test accounts |

## RED — Blockers for PUBLIC launch (not beta)

1. **SQLite → PostgreSQL** — required before scaling beyond controlled beta
2. **Hosted deployment with HTTPS** — currently verified on localhost only
3. **Production secrets** — generate fresh NEXTAUTH_SECRET + IP_HASH_SALT at deploy
4. **No Privacy Policy / ToS pages** — needed for real users
5. **Image uploads** — must never be enabled without the security controls in SECURITY_HARDENING.md

## Test evidence

`scripts/e2e-test.mjs` — 54 automated checks, all passing:
- 8 public pages, registration security (3), auth (3), admin/invites (6), user journey (4), data exposure (3), forum flow (11), blocking (4), reporting/moderation (7), notifications, chat (2), account controls (2)

## How to run the beta

```bash
npm install && npx prisma migrate deploy && npm run seed
npm run build && npm start
```

Seed creates: admin (`ADMIN_USERNAME`/`ADMIN_PASSWORD` env), moderator (`MOD_USERNAME`/`MOD_PASSWORD` env), 10 invite codes (printed to console), categories, chat rooms, badges.
