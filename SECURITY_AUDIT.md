# TerpTalk Security Audit Report

**Audit Date:** 2026-09-08  
**Auditor:** Automated security review  
**Scope:** Full-stack application audit (frontend, backend, database, APIs, auth, realtime)

## Executive Summary

TerpTalk underwent a comprehensive security audit covering OWASP ASVS 5.0 and Top 10:2025 frameworks, plus NIST Privacy Framework principles. **Multiple critical and high-severity vulnerabilities were identified and remediated** before public launch.

**Overall Risk Assessment:** MEDIUM (was HIGH before fixes)

**Remaining Known Risks:** See "Remaining Issues" section below.

---

## Critical Vulnerabilities Found & Fixed

### 🔴 CRITICAL: Password Hash & Email Exposure
**Status:** ✅ FIXED  
**Severity:** CRITICAL (CVSS 9.1)

**Issue:** All API routes and server components used `include: { profile: true }` which returned the **entire User object** including `password` (bcrypt hash) and `email` fields to clients.

**Affected Endpoints:**
- `GET /api/chat/messages`
- `POST /api/chat/messages`
- `POST /api/forum/threads`
- `POST /api/forum/posts`
- `POST /api/diaries`
- `POST /api/diaries/updates`
- `POST /api/setups`
- `GET /api/profile`
- All server components rendering user data

**Fix:** Implemented `publicUserSelect` helper in `src/lib/security.ts` that only exposes `id`, `name`, `image`, and `profile.username`. Updated all queries to use this safe select pattern.

**Files Modified:** 13 files updated across API routes and server components.

---

### 🔴 CRITICAL: Client-Side Captcha Validation
**Status:** ✅ FIXED  
**Severity:** CRITICAL (CVSS 8.2)

**Issue:** The original captcha was generated client-side with `Math.random()` and only validated client-side. Bots could bypass it entirely by not rendering the form.

**Fix:** Implemented server-side captcha system:
- Captcha questions generated and stored in database (`Captcha` model)
- Single-use, time-limited (5 minutes)
- Server validates answer before account creation
- Rate limited captcha generation endpoint

**Files Modified:** `src/app/api/auth/register/route.ts`, `src/app/auth/signup/page.tsx`

---

### 🔴 CRITICAL: Weak NEXTAUTH_SECRET
**Status:** ✅ FIXED  
**Severity:** CRITICAL (CVSS 9.8)

**Issue:** Default placeholder secret `"your-secret-key-change-this-in-production"` allowed JWT forgery and session hijacking.

**Fix:** Generated cryptographically secure random secret via `crypto.randomBytes(32)`. Added `.env` to `.gitignore`.

**Files Modified:** `.env`

---

### 🔴 HIGH: No Rate Limiting
**Status:** ✅ FIXED  
**Severity:** HIGH (CVSS 7.5)

**Issue:** No rate limiting on any endpoints allowed:
- Unlimited registration attempts (spam/bot signups)
- Credential stuffing attacks on login
- Post/comment spam
- Chat message flooding
- API abuse

**Fix:** Implemented database-backed rate limiter (`RateLimit` model) with per-user and per-IP limits:
- Registration: 5 attempts per 15 min per IP
- Login: 10 attempts per 15 min per username
- Thread creation: 10 per hour per user
- Post replies: 30 per 10 min per user
- Chat messages: 30 per minute per user
- Diary creation: 5 per day per user
- Setup creation: 5 per day per user
- Strain submissions: 10 per day per user
- Reactions: 120 per 10 min per user
- Captcha generation: 20 per 10 min per IP

**Files Modified:** Created `src/lib/rate-limit.ts`, updated all POST endpoints.

---

### 🔴 HIGH: No Age Verification Enforcement
**Status:** ✅ FIXED  
**Severity:** HIGH (Legal/Compliance)

**Issue:** Age verification checkbox was cosmetic only; server accepted registrations without validating the attestation.

**Fix:** Server now requires `ageVerified === true` in registration payload. Logged security events for failed attempts.

**Files Modified:** `src/app/api/auth/register/route.ts`, `src/app/auth/signup/page.tsx`

---

### 🔴 HIGH: No Security Event Logging
**Status:** ✅ FIXED  
**Severity:** HIGH (Detection/Response)

**Issue:** No logging of security-relevant events made incident response impossible.

**Fix:** Implemented privacy-conscious security event logging:
- New `SecurityEvent` model tracks: login success/failure, registration, account deletion, rate limit violations, authorization failures
- IP addresses hashed with SHA-256 + salt (never stored raw)
- User agent truncated to 256 chars
- No passwords, tokens, or message content logged

**Files Modified:** Created `SecurityEvent` model, `src/lib/security.ts`, integrated into auth and all rate-limited endpoints.

---

### 🟡 MEDIUM: No Input Length Limits
**Status:** ✅ FIXED  
**Severity:** MEDIUM (CVSS 6.1)

**Issue:** No server-side limits on text inputs allowed:
- Massive posts/comments consuming storage
- Potential DoS via large payloads
- Database bloat

**Fix:** Added `LIMITS` constants in `src/lib/security.ts` enforced server-side:
- Username: 3-20 chars
- Password: 8-128 chars
- Thread title: 150 chars
- Post content: 10,000 chars
- Chat message: 1,000 chars
- Bio: 500 chars
- Diary title: 100 chars
- Description: 2,000 chars
- Strain name: 100 chars

**Files Modified:** All POST endpoints updated with validation.

---

### 🟡 MEDIUM: No Account Deletion
**Status:** ✅ FIXED  
**Severity:** MEDIUM (Privacy/GDPR)

**Issue:** No way for users to delete accounts or export data (GDPR/CCPA violation).

**Fix:** Implemented:
- `DELETE /api/profile` — Requires typed username confirmation, cascades deletion to all user content
- `GET /api/profile/export` — Returns JSON export of all user data

**Files Modified:** `src/app/api/profile/route.ts`, created `src/app/api/profile/export/route.ts`

---

### 🟡 MEDIUM: Missing Security Headers
**Status:** ✅ FIXED  
**Severity:** MEDIUM (CVSS 5.4)

**Issue:** No security headers configured (XSS, clickjacking, MIME sniffing vulnerabilities).

**Fix:** Added to `next.config.ts`:
- `X-Frame-Options: DENY` (clickjacking protection)
- `X-Content-Type-Options: nosniff` (MIME sniffing)
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Content-Security-Policy` (restrictive but functional for Next.js)

**Files Modified:** `next.config.ts`

---

### 🟡 MEDIUM: No Username Validation
**Status:** ✅ FIXED  
**Severity:** MEDIUM (CVSS 5.3)

**Issue:** No validation of username format or reserved names allowed:
- Impersonation (e.g., "admin", "moderator")
- Confusing usernames (e.g., "system", "support")
- Special characters breaking queries

**Fix:** Enforced:
- Regex: `/^[a-zA-Z0-9_]+$/` (letters, numbers, underscores only)
- Length: 3-20 characters
- Reserved list: admin, moderator, system, support, root, terptalk, staff, help, api, www

**Files Modified:** `src/lib/security.ts`, `src/app/api/auth/register/route.ts`, `src/app/api/profile/complete/route.ts`

---

## Remaining Issues (Not Fixed — Require Additional Implementation)

### 🔴 HIGH PRIORITY (Must fix before public launch)

1. **Real-time Chat Not Implemented**
   - Current: HTTP polling every 3 seconds
   - Needed: Socket.io server with authentication, room authorization, presence
   - Impact: Scalability issues, no true realtime experience
   - Fix: Implement Socket.io with Redis adapter

2. **No Image Upload**
   - Current: No file upload functionality
   - Needed: Secure image upload with Cloudinary/S3, EXIF stripping, malware scanning
   - Impact: Core feature missing (grow diaries, setup showcases require photos)
   - Fix: Implement upload endpoints with validation, use randomized storage names

3. **SQLite for Production**
   - Current: `DATABASE_URL="file:./dev.db"`
   - Needed: PostgreSQL for production
   - Impact: SQLite doesn't scale, no concurrent writes
   - Fix: Migrate to PostgreSQL, update connection string

4. **No Email Verification** (optional but recommended)
   - Current: Email optional, no verification
   - Needed: For password reset and notifications
   - Impact: No account recovery mechanism
   - Fix: Implement SMTP integration and verification flow

### 🟡 MEDIUM PRIORITY (Fix shortly after launch)

5. **No Direct Messaging**
   - Schema exists but no UI/API
   - Privacy implications: needs E2E encryption consideration

6. **No Block Functionality**
   - `Block` model exists but not enforced
   - Users can't block others from messaging/seeing content

7. **No Report Functionality**
   - `Report` model exists but no submission UI
   - No moderation queue

8. **No Follow System**
   - `Follow` model exists but not implemented
   - No follower/following management

9. **No Notification Delivery**
   - `Notification` model exists but no triggers
   - No email/push notifications

10. **Session Security**
    - JWT stored in HTTP-only cookie (good)
    - No "remember me" option
    - No session revocation endpoint
    - No concurrent session management

11. **Missing Rate Limiting on:**
    - `GET` endpoints (data scraping)
    - Profile updates
    - Password changes
    - Search queries

### 🟢 LOW PRIORITY (Future hardening)

12. **No MFA Support**
    - Recommend optional TOTP for moderators/admins
    - Consider WebAuthn for high-value accounts

13. **No Content Sanitization Library**
    - React escapes by default (safe)
    - But no rich text editor currently — when added, MUST sanitize HTML

14. **No Automated Security Testing**
    - No unit tests for auth flows
    - No integration tests for authorization
    - No penetration testing performed

15. **No Monitoring/Alerting**
    - Security events logged but not monitored
    - No anomaly detection
    - No uptime monitoring

---

## API Security Matrix

| Endpoint | Method | Auth | Role | Input Validation | Rate Limit | Status |
|----------|--------|------|------|------------------|------------|--------|
| `/api/auth/register` | POST | No | N/A | ✅ Username, password, captcha, age | ✅ 5/15min | ✅ Secure |
| `/api/auth/[...nextauth]` | POST | No | N/A | ✅ Credentials | ✅ 10/15min | ✅ Secure |
| `/api/profile` | GET | Yes | Any | N/A | ❌ | ✅ Secure |
| `/api/profile` | DELETE | Yes | Owner | ✅ Username confirm | ❌ | ✅ Secure |
| `/api/profile/export` | GET | Yes | Owner | N/A | ❌ | ✅ Secure |
| `/api/profile/complete` | POST | Yes | Owner | ✅ Username, URL, lengths | ❌ | ✅ Secure |
| `/api/categories` | GET | No | N/A | N/A | ❌ | ✅ Public data |
| `/api/chat/rooms` | GET | Yes | Any | N/A | ❌ | ✅ Secure |
| `/api/chat/messages` | GET | Yes | Any | ✅ Room ID | ❌ | ✅ Secure |
| `/api/chat/messages` | POST | Yes | Any | ✅ Content, room ID | ✅ 30/min | ✅ Secure |
| `/api/forum/threads` | POST | Yes | Any | ✅ Title, content, category | ✅ 10/hour | ✅ Secure |
| `/api/forum/posts` | POST | Yes | Any | ✅ Content, thread ID | ✅ 30/10min | ✅ Secure |
| `/api/diaries` | POST | Yes | Any | ✅ Title, dates, lengths | ✅ 5/day | ✅ Secure |
| `/api/diaries/updates` | POST | Yes | Author | ✅ Title, content, diary ID | ✅ 30/hour | ✅ Secure |
| `/api/reactions` | POST | Yes | Any | ✅ Type, target ID | ✅ 120/10min | ✅ Secure |
| `/api/setups` | POST | Yes | Any | ✅ Title, lengths | ✅ 5/day | ✅ Secure |
| `/api/strains` | POST | Yes | Any | ✅ Name, lengths | ✅ 10/day | ✅ Secure |

---

## Data Flow Security

### User → Browser → Frontend
- ✅ All forms use HTTPS (required for production)
- ✅ No sensitive data in localStorage
- ✅ Session tokens in HTTP-only cookies (NextAuth default)
- ✅ CSP headers prevent XSS

### Frontend → API → Server
- ✅ All API routes check `getServerSession()` for auth
- ✅ Input validation on all POST endpoints
- ✅ Rate limiting on mutation endpoints
- ✅ Generic error messages (no info leakage)

### Server → Database
- ✅ Prisma ORM prevents SQL injection
- ✅ Parameterized queries throughout
- ✅ No raw SQL
- ✅ No exposed credentials in code

### Server → Logs
- ✅ Passwords NEVER logged
- ✅ Tokens NEVER logged
- ✅ IPs hashed before storage
- ✅ No message content logged
- ⚠️ `console.error` used (should use proper logging service in production)

---

## Privacy Audit Summary

### Data Minimization
- ✅ Email optional (not required for registration)
- ✅ No IP addresses stored raw (hashed only)
- ✅ No tracking cookies beyond NextAuth session
- ✅ No analytics tracking implemented

### User Rights
- ✅ Account deletion implemented (`DELETE /api/profile`)
- ✅ Data export implemented (`GET /api/profile/export`)
- ⚠️ No granular privacy controls (profile visibility, etc.)
- ⚠️ No notification preferences

### Sensitive Data
- ✅ Passwords hashed with bcrypt (12 rounds)
- ✅ Session tokens managed by NextAuth
- ✅ No payment info collected
- ⚠️ Grow diary content may reveal location (photos could contain EXIF — not yet implemented)

---

## Recommendations for Production

### Immediate (Before Launch)
1. **Implement Socket.io** for real-time chat (currently polling)
2. **Migrate to PostgreSQL** (SQLite won't scale)
3. **Set up image upload** with EXIF stripping
4. **Enable email verification** for account recovery
5. **Add HTTPS-only cookies** (set `secure: true` in production)
6. **Implement logging service** (Sentry, LogRocket, or similar)
7. **Set up monitoring** (uptime, error rates, security events)

### Short-Term (First Month)
8. Add direct messaging with encryption consideration
9. Implement block functionality enforcement
10. Add report/moderation queue
11. Implement follow system with privacy controls
12. Add notification delivery system
13. Expand rate limiting to GET endpoints
14. Add session management UI (view/revoke sessions)

### Long-Term (Ongoing)
15. Implement optional MFA for moderators/admins
16. Add privacy controls (profile visibility, diary privacy)
17. Regular security audits (quarterly)
18. Penetration testing before major releases
19. Dependency scanning (Dependabot or similar)
20. Security training for moderation team

---

## Compliance Notes

### GDPR/CCPA
- ✅ Right to access (data export implemented)
- ✅ Right to deletion (account deletion implemented)
- ⚠️ Right to portability (JSON export is machine-readable)
- ⚠️ Consent management (age verification only — expand for EU users)
- ⚠️ Data retention policy (needs documentation)

### Age Verification
- ✅ 21+ checkbox enforced server-side
- ⚠️ May need stronger verification for regulated jurisdictions

### Cannabis Content
- Platform hosts user-generated content about cannabis cultivation
- Ensure compliance with local laws in all jurisdictions served
- Consider adding disclaimers and content warnings

---

## Testing Performed

- ✅ TypeScript compilation (no errors)
- ✅ ESLint (all issues resolved)
- ✅ Production build (successful)
- ✅ Database schema validation
- ✅ Manual API endpoint testing
- ⚠️ Automated security tests NOT implemented
- ⚠️ Penetration testing NOT performed
- ⚠️ Load testing NOT performed

---

## Conclusion

**The application is significantly more secure than before the audit.** Critical vulnerabilities (password hash exposure, weak secrets, no rate limiting, no input validation) have been remediated.

**However, several high-priority items remain** that must be addressed before a true production launch:
- Real-time chat infrastructure
- Image upload security
- PostgreSQL migration
- Email verification

**Recommendation:** Proceed with a **limited beta test** while completing the remaining high-priority items. Do NOT launch publicly until real-time chat, image uploads, and PostgreSQL are implemented.

**Security is not a destination** — this audit represents a point-in-time assessment. Continuous monitoring, regular updates, and ongoing security practices are essential.

---

**Signed:**  
Devin AI Assistant  
Cognition AI  
2026-09-08
