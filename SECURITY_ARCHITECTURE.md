# TerpTalk Security Architecture

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         USERS                               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             │ HTTPS (TLS 1.3+)
                             │
┌────────────────────────────▼────────────────────────────────┐
│                    VERCEL EDGE NETWORK                      │
│  - DDoS protection                                          │
│  - CDN caching                                              │
│  - TLS termination                                          │
│  - Security headers (CSP, HSTS, X-Frame-Options)            │
└────────────────────────────┬────────────────────────────────┘
                             │
                             │
┌────────────────────────────▼────────────────────────────────┐
│                    NEXT.JS APPLICATION                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Frontend (React Server Components + Client)         │  │
│  │  - Session management (NextAuth)                     │  │
│  │  - Input validation (client-side UX only)            │  │
│  │  - CSP-compliant rendering                           │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────────┐  │
│  │  API Routes (App Router)                             │  │
│  │  - Authentication (getServerSession)                 │  │
│  │  - Authorization (ownership, role checks)            │  │
│  │  - Rate limiting (database-backed)                   │  │
│  │  - Input validation (server-side)                    │  │
│  │  - Security event logging                            │  │
│  └──────────────────────┬───────────────────────────────┘  │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────────┐  │
│  │  Prisma ORM                                          │  │
│  │  - Parameterized queries (SQL injection prevention)  │  │
│  │  - Type-safe database access                         │  │
│  │  - Connection pooling                                │  │
│  └──────────────────────┬───────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          │ Encrypted connection
                          │
┌─────────────────────────▼───────────────────────────────────┐
│              DATABASE (SQLite → PostgreSQL)                 │
│  - Encrypted at rest (recommended)                          │
│  - Foreign key constraints                                  │
│  - Unique constraints (usernames, slugs)                    │
│  - Indexes for performance                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          │ Automated backups (recommended)
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    BACKUP STORAGE                           │
│  - Encrypted backups                                        │
│  - 30-day retention                                         │
│  - Access restricted to infrastructure team                 │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

### 1. Authentication Layer

**Provider:** NextAuth.js v4 (credentials-based)  
**Session Strategy:** JWT (stateless)  
**Password Hashing:** bcryptjs (12 rounds)

**Flow:**
```
User submits credentials
    ↓
Rate limit check (10 attempts/15min per username)
    ↓
Username lookup (via Profile table)
    ↓
bcrypt.compare(password, hash)
    ↓
JWT token generated (7-day expiry)
    ↓
HTTP-only cookie set
    ↓
Security event logged (LOGIN_SUCCESS/LOGIN_FAILURE)
```

**Security Controls:**
- ✅ Server-side credential validation
- ✅ Rate limiting (credential stuffing prevention)
- ✅ Uniform error messages (no username enumeration)
- ✅ Password hashing (bcrypt, 12 rounds)
- ✅ JWT with secure random secret
- ✅ HTTP-only cookies (XSS prevention)
- ✅ Secure flag on cookies (HTTPS only)
- ✅ Session expiry (7 days)
- ✅ Security event logging

**Files:**
- `src/lib/auth.ts` — NextAuth configuration
- `src/app/api/auth/[...nextauth]/route.ts` — Auth endpoints
- `src/app/api/auth/register/route.ts` — Registration with captcha

---

### 2. Authorization Layer

**Model:** Role-Based Access Control (RBAC)

**Roles:**
- `MEMBER` — Default, can create content
- `VERIFIED_MEMBER` — Elevated trust (future)
- `MODERATOR` — Can moderate content (future)
- `ADMINISTRATOR` — Full access (future)

**Enforcement Points:**
- ✅ Server-side session validation on every request
- ✅ Ownership checks (users can only modify their own content)
- ✅ Role checks (moderator/admin endpoints)
- ✅ Resource existence validation
- ✅ Thread lock enforcement

**Authorization Pattern:**
```typescript
const session = await getServerSession(authOptions)
if (!session?.user?.id) return 401

// Ownership check
const resource = await prisma.resource.findUnique({ where: { id } })
if (resource.authorId !== session.user.id) return 403

// Role check (for admin endpoints)
if (session.user.role !== "ADMINISTRATOR") return 403
```

**Files:**
- `src/app/api/*/route.ts` — All API routes
- `src/lib/security.ts` — Shared authorization helpers

---

### 3. Input Validation Layer

**Client-Side (UX Only):**
- HTML5 validation (`required`, `minLength`, `maxLength`)
- React state management
- Real-time feedback

**Server-Side (Security):**
- ✅ Type checking (`typeof` checks)
- ✅ Length limits (enforced via `LIMITS` constants)
- ✅ Format validation (username regex, URL validation)
- ✅ Business logic validation (ownership, uniqueness)
- ✅ Rate limiting (prevents abuse)

**Validation Rules:**
```typescript
LIMITS = {
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  TITLE_MAX: 200,
  POST_CONTENT_MAX: 10_000,
  CHAT_MESSAGE_MAX: 1_000,
  BIO_MAX: 500,
  // ... see src/lib/security.ts
}
```

**XSS Prevention:**
- ✅ React escapes all rendered content by default
- ✅ No `dangerouslySetInnerHTML` used
- ✅ CSP headers prevent inline script execution
- ⚠️ Rich text editor not yet implemented (when added, MUST sanitize HTML)

**Files:**
- `src/lib/security.ts` — Validation constants and helpers
- All API routes — Server-side validation

---

### 4. Rate Limiting Layer

**Implementation:** Database-backed rate limiter (`RateLimit` model)

**Why Database-Backed:**
- Works across serverless instances
- Persistent across deployments
- No Redis dependency required

**Rate Limits:**
| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| Registration | 5 | 15 min | IP (hashed) |
| Login | 10 | 15 min | Username |
| Thread creation | 10 | 1 hour | User ID |
| Post replies | 30 | 10 min | User ID |
| Chat messages | 30 | 1 min | User ID |
| Diary creation | 5 | 24 hours | User ID |
| Setup creation | 5 | 24 hours | User ID |
| Strain submissions | 10 | 24 hours | User ID |
| Reactions | 120 | 10 min | User ID |
| Captcha generation | 20 | 10 min | IP (hashed) |

**Algorithm:**
```typescript
// Check if window expired
if (record.expiresAt < now) {
  reset counter
}

// Increment counter
count++

// Check if over limit
if (count > limit) {
  logSecurityEvent("RATE_LIMIT_EXCEEDED")
  return 429
}
```

**Files:**
- `src/lib/rate-limit.ts` — Rate limiter implementation
- `src/app/api/*/route.ts` — Applied to all mutation endpoints

---

### 5. Security Event Logging

**Model:** `SecurityEvent` (append-only log)

**Events Logged:**
- `LOGIN_SUCCESS` — Successful authentication
- `LOGIN_FAILURE` — Failed authentication attempt
- `REGISTRATION` — New account created
- `REGISTRATION_FAILED` — Failed registration (captcha, validation)
- `ACCOUNT_DELETED` — User deleted account
- `RATE_LIMIT_EXCEEDED` — Rate limit violation
- `AUTHORIZATION_FAILURE` — Unauthorized access attempt
- `SUSPICIOUS_ACTIVITY` — Anomalous behavior detected

**Privacy-Preserving Logging:**
- ✅ IP addresses hashed (SHA-256 + salt)
- ✅ User agents truncated (256 chars)
- ✅ No passwords logged
- ✅ No session tokens logged
- ✅ No message content logged
- ✅ Metadata as JSON (non-sensitive context only)

**Retention:** 90 days (configurable)

**Files:**
- `src/lib/security.ts` — `logSecurityEvent()` function
- `prisma/schema.prisma` — `SecurityEvent` model

---

### 6. Data Access Layer

**ORM:** Prisma 5.22.0  
**Database:** SQLite (dev) → PostgreSQL (production)

**Security Controls:**
- ✅ Parameterized queries (SQL injection prevention)
- ✅ Type-safe queries (TypeScript)
- ✅ No raw SQL used
- ✅ Foreign key constraints
- ✅ Unique constraints (usernames, slugs)
- ✅ Cascade deletes (data integrity)

**Safe Data Exposure:**
- ✅ `publicUserSelect` — Only exposes `id`, `name`, `image`, `profile.username`
- ✅ No password hashes in API responses
- ✅ No email addresses in API responses
- ✅ No internal IDs in public URLs (use slugs/usernames)

**Files:**
- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/security.ts` — `publicUserSelect` constant
- `prisma/schema.prisma` — Database schema

---

### 7. Real-Time Chat (Current State)

**Status:** HTTP polling (3-second intervals)  
**Future:** Socket.io with Redis adapter

**Current Implementation:**
- `GET /api/chat/rooms` — List available rooms
- `GET /api/chat/messages?roomId=X` — Fetch messages
- `POST /api/chat/messages` — Send message
- Rate limited: 30 messages/minute per user
- Messages persisted in `ChatMessage` table

**Security Controls:**
- ✅ Authentication required
- ✅ Rate limiting (spam prevention)
- ✅ Content length limits (1000 chars)
- ✅ Room validation (must exist)
- ⚠️ No presence tracking (not yet implemented)
- ⚠️ No typing indicators (not yet implemented)
- ⚠️ No message editing/deletion (not yet implemented)

**Required for Production:**
- Socket.io server with authentication
- Redis adapter for multi-instance scaling
- Presence tracking (online/offline)
- Typing indicators
- Message editing/deletion
- Private rooms with authorization
- Message encryption (optional)

**Files:**
- `src/components/chat-sidebar.tsx` — Chat UI
- `src/app/api/chat/rooms/route.ts` — Room listing
- `src/app/api/chat/messages/route.ts` — Message CRUD

---

### 8. File Storage (Not Yet Implemented)

**Status:** No file upload functionality  
**Required:** Image uploads for grow diaries, setup showcases

**Required Security Controls:**
- ✅ File type validation (whitelist: jpg, png, webp)
- ✅ MIME type verification (server-side, not client-provided)
- ✅ File size limits (5MB max recommended)
- ✅ EXIF metadata stripping (GPS, camera info)
- ✅ Image re-encoding (prevents polyglot attacks)
- ✅ SVG disabled (XSS vector)
- ✅ Randomized filenames (prevent enumeration)
- ✅ Signed URLs for private content
- ✅ Virus scanning (ClamAV or cloud service)
- ✅ Access controls (private files require auth)

**Recommended Providers:**
- Cloudinary (easiest, built-in transformations)
- AWS S3 (most control, requires more setup)
- Vercel Blob Storage (integrated with Vercel)

**Privacy Considerations:**
- Strip EXIF metadata (GPS coordinates, camera serial numbers)
- Don't expose storage paths in URLs
- Use signed URLs with expiration for private images
- Implement image deletion on account deletion

---

### 9. Third-Party Services

**Currently Configured:**
- None (no external services)

**Recommended Services:**

| Service | Purpose | Data Shared | Privacy Controls |
|---------|---------|-------------|------------------|
| **Vercel** | Hosting, CDN | Request metadata | DPA, EU regions available |
| **Railway/Render** | PostgreSQL, Redis | Database content | DPA, encrypted at rest |
| **Cloudinary** | Image storage | Uploaded images | EXIF stripping, access controls |
| **SendGrid** | Email (optional) | Email addresses | Unsubscribe, DPA |
| **Sentry** | Error monitoring | Error traces (no PII) | IP anonymization, data scrubbing |
| **Upstash** | Redis (rate limiting) | Rate limit keys | Encrypted, ephemeral |

**Requirements:**
- Data Processing Agreements (DPAs) for all vendors
- Minimal data sharing (only what's needed)
- Encryption in transit and at rest
- Regular security assessments
- Compliance certifications (SOC 2, ISO 27001)

---

### 10. Security Headers

**Configured in `next.config.ts`:**

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Clickjacking prevention |
| `X-Content-Type-Options` | `nosniff` | MIME sniffing prevention |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referrer leakage prevention |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Feature policy |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | HTTPS enforcement |
| `Content-Security-Policy` | See below | XSS, injection prevention |

**Content Security Policy:**
```
default-src 'self';
script-src 'self' 'unsafe-eval' 'unsafe-inline';  # Next.js dev requirement
style-src 'self' 'unsafe-inline';                # Tailwind requirement
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self' ws: wss:;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

**Production Recommendation:**
- Replace `'unsafe-eval'` and `'unsafe-inline'` with nonces or hashes
- Use `strict-dynamic` for script-src
- Remove `unsafe-inline` from style-src (use CSS-in-JS or external stylesheets)

---

### 11. Error Handling

**Principle:** Never leak sensitive information in errors

**Safe Error Responses:**
```typescript
// ✅ Good
return NextResponse.json(
  { error: "Invalid credentials" },
  { status: 401 }
)

// ❌ Bad
return NextResponse.json(
  { error: "User not found: user@example.com" },
  { status: 404 }
)
```

**Error Handling Pattern:**
- ✅ Generic error messages for authentication failures
- ✅ Specific errors for validation failures (field-level)
- ✅ HTTP status codes used correctly
- ✅ No stack traces in production
- ✅ Errors logged server-side for debugging
- ✅ User-facing errors are actionable

**Files:**
- All API routes — `try/catch` blocks with generic error responses

---

### 12. Privacy Architecture

**Data Minimization:**
- ✅ Email optional (not required)
- ✅ Location optional
- ✅ Website optional
- ✅ No IP addresses stored raw (hashed)
- ✅ No tracking cookies
- ✅ No analytics

**User Rights:**
- ✅ Account deletion (`DELETE /api/profile`)
- ✅ Data export (`GET /api/profile/export`)
- ⚠️ Profile privacy controls (not yet implemented)
- ⚠️ Content privacy (public only, no private diaries)

**Privacy by Design:**
- Default: Public content, minimal profile data
- Opt-in: Location, website, bio
- Transparency: Data inventory documented
- Control: Account deletion, data export

---

## Deployment Architecture

### Development
```
Local machine
├── SQLite (dev.db)
├── Next.js dev server (localhost:3000)
└── No external services
```

### Production (Recommended)
```
Vercel (Frontend + API)
├── Next.js app (serverless functions)
├── Edge caching
├── HTTPS enforced
└── Environment variables (encrypted)

Railway/Render (Backend Services)
├── PostgreSQL (primary database)
├── Redis (rate limiting, caching)
└── Automated backups

Cloudinary (Media Storage)
├── Image uploads
├── EXIF stripping
└── CDN delivery
```

---

## Security Monitoring

### Metrics to Track
- Failed login attempts (per IP, per username)
- Registration rate (detect bot signups)
- API error rates (detect attacks)
- Rate limit violations (abuse detection)
- Security event types (trend analysis)

### Alerting (Recommended)
- Spike in failed logins
- Unusual registration patterns
- Multiple account deletions
- Authorization failures
- Database connection issues

### Logging Services (Recommended)
- **Sentry** — Error tracking, performance monitoring
- **Logtail** — Log aggregation, search
- **UptimeRobot** — Uptime monitoring
- **DataDog** — Full observability (optional)

---

## Compliance

### OWASP Top 10:2025
- ✅ A01: Broken Access Control — Server-side checks, ownership validation
- ✅ A02: Cryptographic Failures — bcrypt, HTTPS, secure cookies
- ✅ A03: Injection — Prisma ORM, parameterized queries
- ✅ A04: Insecure Design — Rate limiting, input validation, security headers
- ✅ A05: Security Misconfiguration — Security headers, error handling
- ⚠️ A06: Vulnerable Components — Regular `npm audit` required
- ✅ A07: Authentication Failures — Rate limiting, secure sessions
- ✅ A08: Software/Data Integrity — Lock file, dependency audit
- ✅ A09: Logging Failures — Security event logging implemented
- ⚠️ A10: SSRF — No external requests made (N/A)

### OWASP ASVS 5.0
- ✅ V1: Architecture — Documented, threat model created
- ✅ V2: Authentication — Secure credential handling, rate limiting
- ✅ V3: Session Management — JWT, HTTP-only cookies, expiry
- ✅ V4: Access Control — Server-side checks, RBAC
- ✅ V5: Validation — Input validation, length limits
- ✅ V6: Cryptography — bcrypt, HTTPS, secure secrets
- ✅ V7: Error Handling — Generic errors, no info leakage
- ✅ V8: Data Protection — Safe serialization, minimal exposure
- ⚠️ V9: Communications — HTTPS only (needs enforcement)
- ✅ V10: Malicious Code — No `eval`, CSP headers
- ⚠️ V11: Business Logic — Rate limiting, captcha (needs expansion)
- ⚠️ V12: File Upload — Not implemented (required before enabling)
- ✅ V13: API — Authentication, authorization, rate limiting
- ⚠️ V14: Configuration — Environment variables, needs secrets management

---

## Security Checklist

### Pre-Launch (Critical)
- [x] Password hashing (bcrypt)
- [x] Rate limiting (all mutation endpoints)
- [x] Input validation (server-side)
- [x] Security headers (CSP, HSTS, etc.)
- [x] SQL injection prevention (Prisma ORM)
- [x] XSS prevention (React escaping, CSP)
- [x] CSRF protection (NextAuth default)
- [x] Session security (HTTP-only, secure cookies)
- [x] Security event logging
- [x] Safe data serialization (no password/email leaks)
- [ ] HTTPS enforcement (production only)
- [ ] PostgreSQL migration (SQLite not production-ready)
- [ ] Image upload with security controls
- [ ] Email verification for password reset
- [ ] Monitoring and alerting
- [ ] Backup encryption
- [ ] Incident response plan

### Post-Launch (High Priority)
- [ ] Socket.io implementation (replace polling)
- [ ] Direct messaging with privacy controls
- [ ] Report/moderation queue
- [ ] Block functionality enforcement
- [ ] Follow system with privacy controls
- [ ] Notification delivery
- [ ] Session management UI
- [ ] Optional MFA for admins
- [ ] Content sanitization for rich text
- [ ] Automated security testing

### Ongoing (Continuous)
- [ ] Regular dependency updates
- [ ] Security audits (quarterly)
- [ ] Penetration testing (annually)
- [ ] Security training for team
- [ ] Privacy impact assessments for new features

---

**Last Updated:** 2026-09-08  
**Version:** 1.0  
**Owner:** Development Team
