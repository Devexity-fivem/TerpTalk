# TerpTalk Beta — Release Notes

## What this is

Invite-only beta of TerpTalk: a cannabis-focused community with forums, grow diaries, grow setups, strain database, chat, and full moderation tooling. Built on Next.js 16, React 19, Prisma 5, SQLite (dev/beta), NextAuth credentials.

## New in this release

- **Invite-only registration** — `BetaInvite` model, single-use `TERP-XXXXXXXX` codes, admin-generated on `/admin`
- **Blocking** — block/unblock from any profile; blocked users see 404; blocks are private
- **Reporting** — report threads, posts, chat, profiles, diaries, setups with 7 reason categories
- **Moderation queue** — `/moderation`: review reports, remove content, resolve/dismiss, full action log
- **Admin dashboard** — `/admin`: community stats, security event counts, invite management
- **Edit & delete own content** — posts get an `(edited)` marker; soft-delete everywhere
- **Notifications** — `/notifications` page + nav badge; replies and moderation actions notify
- **Public profiles** — `/u/username` with stats, recent threads, block/report buttons
- **Banned-account enforcement** — login block + all mutations reject suspended accounts
- **Account privacy controls** — data export (JSON) and self-service deletion on `/profile`
- **Backups** — `npm run backup` (SQLite copy / pg_dump), 30-day retention
- **Real stats** — feed "Community Stats" now shows real member/thread/diary counts
- **Removed fake UI** — "247 Online" badge, dead Bookmark/Share/Reply buttons, dead feed tabs now marked "Soon"

## Verified security posture

- 54-check E2E suite passing (`scripts/e2e-test.mjs`)
- Zero dependency vulnerabilities (`npm audit`)
- No password/email exposure in any API or server-rendered payload
- Server-side enforcement for: age gate, invite, captcha, bans, ownership, roles, rate limits, content lengths
- Security headers: CSP, HSTS, frame-deny, nosniff, referrer policy

## Known limitations (see SOFT_LAUNCH_READINESS.md)

Chat polling, SQLite (beta scale only), no password reset, no image uploads, no DMs.

## For testers

See `BETA_TEST_PLAN.md`. You'll get a `TERP-` invite code from an admin.
