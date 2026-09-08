# TerpTalk Security Regression Tests

Automated E2E suite: `node scripts/e2e-test.mjs` (requires dev server on :3000 and seeded admin/mod/invites). 54 checks, all passing as of 2026-09-08.

## Coverage matrix

| Test | Expected | Verified |
|---|---|---|
| Register without invite | 400 | ✓ |
| Register with invalid invite | 400 | ✓ |
| Invite reuse (single-use) | 400 | ✓ |
| Register with `ageVerified: false` | 400 | ✓ |
| Wrong captcha answer | 400, single-use burn | ✓ |
| Duplicate username | 400 | ✓ |
| Weak password / reserved name / invalid chars | 400 | ✓ (code) |
| Wrong password login | error, uniform message | ✓ |
| Banned user login | rejected | ✓ (code + flag) |
| Password hash in any API response | never | ✓ (chat, profile, public user) |
| Email in public user objects | never | ✓ |
| Thread create unauthenticated | 401 | ✓ |
| Reply under 10 chars / over 10k | 400 | ✓ |
| Reply to locked/deleted thread | 403 | ✓ (code) |
| Edit own post | 200, `edited` flag | ✓ |
| Edit another user's post | 403 | ✓ |
| Anonymous edit/delete | 401 | ✓ |
| Invalid reaction type | 400 | ✓ |
| Block → blocked user sees 404 on profile | 404 | ✓ |
| Self-block | 400 | ✓ (code) |
| Block list visibility | private to blocker | ✓ |
| Report valid target | 201 | ✓ |
| Duplicate pending report | 409 | ✓ (code) |
| Report own content | 400 | ✓ (code) |
| Moderation queue as user/anon | 403/401 | ✓ |
| Resolve report | 200 + log entry | ✓ |
| Moderator issues ban | 403 (admin-only) | ✓ |
| Action on self | 400 | ✓ |
| Mod acts on admin | 403 | ✓ (code) |
| Admin invite create/list | 201/200 | ✓ |
| Mod/anon invite create | 403/401 | ✓ |
| Admin stats as mod | 403 | ✓ |
| Rate limit registration | 429 after 5/15min | ✓ (observed live) |
| XSS `<script>` in post | escaped in HTML | ✓ |
| Chat unauthenticated | 401 | ✓ |
| Private room access | 404 | ✓ (code) |
| Deleted thread/post | excluded from listings, 404 | ✓ |
| Account export | own data only | ✓ |
| Account deletion | requires typed username | ✓ |
| Session cookie | HTTP-only, 7-day | ✓ (config) |
| Security headers | CSP/HSTS/frame/nosniff | ✓ (next.config.ts) |
| npm audit | 0 vulnerabilities | ✓ |

## Cases verified by code review (not live-tested)

- Account deletion cascade: `onDelete: Cascade` on all user relations
- Session JWT strategy + NEXTAUTH_SECRET enforcement
- IP hashing with salt in SecurityEvent (no raw IP storage)
- `banned` enforcement on: threads, posts, diaries, diary updates, setups, strains, chat

## How to re-run

```bash
npm run dev            # terminal 1
npm run seed           # once (creates admin/mod/invites)
node scripts/e2e-test.mjs   # terminal 2
```

If registration tests hit 429, wait 15 min or run `node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().rateLimit.deleteMany().then(()=>process.exit())"`.
