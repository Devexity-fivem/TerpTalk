# TerpTalk Security Changelog

## 2026-09-08 — Pre-Launch Security Audit

### Critical Fixes

- **Fixed mass sensitive-data exposure**: All API routes and server components that included `author: { include: { profile: true } }` returned the full User row — including the `password` hash and `email`. Replaced with `publicUserSelect` (id, name, image, profile.username only) across 13 files. New helper: `src/lib/security.ts`.
- **Rotated weak NEXTAUTH_SECRET**: Replaced placeholder with a 32-byte random hex. `.env` confirmed gitignored. **Action required:** generate a new unique secret per environment at deploy time; the dev value must never be reused in production.
- **Fixed client-side-only CAPTCHA**: Captcha answers are now generated server-side via `crypto.randomInt`, persisted in the new `Captcha` table, single-use, and expire after 5 minutes. Registration validates server-side.
- **Fixed age-verification bypass**: Server now requires `ageVerified === true` in the registration payload instead of hardcoding it.

### High-Severity Fixes

- **Added database-backed rate limiting** (`RateLimit` model, `src/lib/rate-limit.ts`) — works across serverless instances:
  - Registration: 5/15min per IP (hashed)
  - Login: 10/15min per username (in `authorize`)
  - Threads: 10/hr · Posts: 30/10min · Chat: 30/min · Reactions: 120/10min
  - Diaries: 5/day · Setups: 5/day · Strains: 10/day · Captcha: 20/10min
- **Added server-side input validation & length limits** on all mutation endpoints (LIMITS in `src/lib/security.ts`).
- **Added reaction type allowlist** and single-target enforcement (postId XOR diaryId).
- **Added security headers** in `next.config.ts`: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy.
- **Added security event logging** (`SecurityEvent` model + `logSecurityEvent`): login success/failure, registration, account deletion, rate-limit violations. IPs are salted SHA-256 hashes — never stored raw.
- **Session hardening**: JWT maxAge 7 days, daily token refresh.
- **Moved authOptions** to `src/lib/auth.ts` (prevents importing route internals).

### Privacy Features Added

- `DELETE /api/profile` — account deletion with typed-username confirmation; cascades all user content.
- `GET /api/profile/export` — full JSON data export (GDPR access right).
- Username validation: 3–20 chars, `[a-zA-Z0-9_]`, reserved-name blocklist; applied to registration and profile update.
- Profile update validates bio/location/website lengths and URL scheme.

### Schema Changes

Migration `20260908163805_add_security_models`:
- `SecurityEvent` (type, userId, ipHash, userAgent, metadata)
- `RateLimit` (key, count, expiresAt)
- `Captcha` (id, answer, expiresAt, used)

### Documentation Created

`SECURITY_AUDIT.md`, `THREAT_MODEL.md`, `SECURITY_ARCHITECTURE.md`, `DATA_INVENTORY.md`, `INCIDENT_RESPONSE.md`, `SECURITY_HARDENING.md`, `SECURITY_TEST_PLAN.md`, `SECURITY_CHANGELOG.md`, `PRODUCTION_CHECKLIST.md`

### Known Remaining Risks (tracked in SECURITY_AUDIT.md)

- SQLite must be migrated to PostgreSQL for production
- Chat uses 3s polling; Socket.io+Redis required for production scale
- No image upload yet — must implement EXIF stripping/scanning when added
- No email/password-reset flow yet
- `npm audit` reports 2 critical dependency findings — review before launch
+ Dependency vulnerabilities: FIXED via `overrides` — `cookie@^0.7.2` and `@auth/core@^0.41.3` (npm audit: 0 vulnerabilities). Note: `next-auth@4.x` pins vulnerable `@auth/core`; the override resolves the advisories, but long-term plan should be migrating to Auth.js v5.
- No automated security test suite yet (plan in SECURITY_TEST_PLAN.md)
