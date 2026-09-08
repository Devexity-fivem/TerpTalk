# TerpTalk Data Inventory & Privacy Map

## Purpose

This document inventories all user data collected by TerpTalk, where it's stored, who can access it, and how it's protected. It serves as the foundation for privacy compliance (GDPR, CCPA) and security audits.

---

## Data Collection Table

| Data Type | Purpose | Storage Location | Access Control | Retention | Required? | Shared? | Deletable? |
|-----------|---------|------------------|----------------|-----------|-----------|---------|------------|
| **Username** | Public identity, authentication | `Profile.username` | Public | Until account deletion | ✅ Yes | ✅ Public | ✅ Yes (on deletion) |
| **Password** | Authentication | `User.password` | Never exposed | Until account deletion | ✅ Yes | ❌ Never | ✅ Yes (on deletion) |
| **Email** (optional) | Account recovery, notifications | `User.email` | User only | Until account deletion | ❌ No | ❌ Never | ✅ Yes (on deletion) |
| **Display Name** | Public profile | `User.name` | Public | Until account deletion | ✅ Yes | ✅ Public | ✅ Yes (on deletion) |
| **Avatar** | Profile picture | `User.image` | Public | Until account deletion | ❌ No | ✅ Public | ✅ Yes (on deletion) |
| **Bio** | User description | `Profile.bio` | Public | Until account deletion | ❌ No | ✅ Public | ✅ Yes (on deletion) |
| **Location** (optional) | Regional discussions | `Profile.location` | Public | Until account deletion | ❌ No | ✅ Public | ✅ Yes (on deletion) |
| **Website** (optional) | External link | `Profile.website` | Public | Until account deletion | ❌ No | ✅ Public | ✅ Yes (on deletion) |
| **Age Verification** | Legal compliance | `User.ageVerified` | Internal | Until account deletion | ✅ Yes | ❌ Never | ✅ Yes (on deletion) |
| **Role** | Authorization | `User.role` | Internal | Until account deletion | Auto | ❌ Never | ✅ Yes (on deletion) |
| **Account Status** | Presence indicator | `User.status` | Public (presence) | Until account deletion | Auto | ⚠️ Public (online/offline) | ✅ Yes (on deletion) |
| **Last Seen** | Presence feature | `User.lastSeenAt` | Internal | Until account deletion | Auto | ⚠️ Public (timestamp) | ✅ Yes (on deletion) |
| **Join Date** | Community tenure | `Profile.joinDate` | Public | Until account deletion | Auto | ✅ Public | ✅ Yes (on deletion) |
| **Reputation** | Gamification | `Profile.reputation` | Public | Until account deletion | Auto | ✅ Public | ✅ Yes (on deletion) |
| **Forum Posts** | Community content | `Post`, `Thread` | Public | Until deleted or account deleted | User creates | ✅ Public | ✅ Yes |
| **Grow Diaries** | User content | `GrowDiary`, `DiaryUpdate` | Public | Until deleted or account deleted | User creates | ✅ Public | ✅ Yes |
| **Grow Setups** | User content | `GrowSetup` | Public | Until deleted or account deleted | User creates | ✅ Public | ✅ Yes |
| **Chat Messages** | Community chat | `ChatMessage` | Room members | Until deleted or account deleted | User creates | ⚠️ Room members | ✅ Yes |
| **Direct Messages** | Private communication | `DirectMessage` | Sender + recipient only | Until deleted or account deleted | User creates | ❌ Private | ✅ Yes |
| **Reactions** | Engagement | `Reaction` | Public (counts) | Until account deletion | User creates | ✅ Public (aggregated) | ✅ Yes |
| **Follows** | Social graph | `Follow` | Public (counts) | Until account deletion | User creates | ✅ Public | ✅ Yes |
| **Blocks** | User safety | `Block` | Blocker only | Until unblocked or account deleted | User creates | ❌ Private | ✅ Yes |
| **Reports** | Moderation | `Report` | Reporter + moderators | 90 days after resolution | User creates | ❌ Moderators only | ⚠️ Retained for moderation |
| **Moderation Actions** | Accountability | `ModerationAction` | Moderators + admins | Indefinite (audit trail) | System | ❌ Internal | ❌ No (audit log) |
| **Badges** | Gamification | `UserBadge`, `Badge` | Public | Until account deletion | System | ✅ Public | ✅ Yes (on deletion) |
| **Reputation Events** | Reputation tracking | `ReputationEvent` | User + internal | Until account deletion | System | ⚠️ Aggregated public | ✅ Yes (on deletion) |
| **Notifications** | User alerts | `Notification` | User only | Until read or account deleted | System | ❌ Private | ✅ Yes |
| **Security Events** | Security monitoring | `SecurityEvent` | Internal only | 90 days | System | ❌ Internal | ⚠️ 90-day retention |
| **IP Address** | Rate limiting, security | `SecurityEvent.ipHash` | Internal only | 90 days | System | ❌ Never (hashed) | ⚠️ 90-day retention |
| **User Agent** | Security monitoring | `SecurityEvent.userAgent` | Internal only | 90 days | System | ❌ Never | ⚠️ 90-day retention |
| **Session Data** | Authentication | JWT (client-side) | User's browser | 7 days | System | ❌ Never | ✅ Yes (logout) |
| **Calendar Events** | Grow planning | `CalendarEvent` | Diary owner | Until deleted or account deleted | User creates | ⚠️ Public via diary | ✅ Yes |
| **Environment Readings** | Grow tracking | `EnvironmentReading` | Diary owner | Until deleted or account deleted | User creates | ⚠️ Public via diary | ✅ Yes |
| **Strain Database** | Reference data | `Strain` | Public | Permanent | Community | ✅ Public | ⚠️ Curated |
| **Chat Rooms** | Community structure | `ChatRoom` | Public | Permanent | System | ✅ Public | ❌ No |
| **Forum Categories** | Content organization | `Category` | Public | Permanent | System | ✅ Public | ❌ No |

---

## Data Processing Locations

### 1. Browser (Client-Side)
**Stored:**
- NextAuth session cookie (JWT, HTTP-only, secure)
- Form data (transient, cleared on submission)
- Chat messages (temporary state)

**Transmitted:**
- All user input sent to server via HTTPS
- Authentication credentials (username + password)
- Content submissions (posts, diaries, chat)

**Privacy Controls:**
- No localStorage for sensitive data
- No tracking cookies
- No third-party analytics

---

### 2. Frontend → API (Transit)
**Encrypted:** All API calls over HTTPS (required in production)

**Data sent:**
- Credentials (username, password)
- Profile updates
- Content (posts, diaries, messages)
- Reactions, follows
- File uploads (when implemented)

**Privacy Controls:**
- HTTPS enforced via HSTS
- No sensitive data in URLs
- Session tokens in HTTP-only cookies

---

### 3. API → Server (Processing)
**Processing:**
- Input validation (type, length, format)
- Authentication checks (`getServerSession`)
- Authorization checks (ownership, role)
- Rate limiting (per-user, per-IP)

**Logging:**
- Security events (login, registration, deletion)
- Rate limit violations
- Authorization failures
- **NOT logged:** Passwords, tokens, message content, full request bodies

**Privacy Controls:**
- IP addresses hashed before storage
- User agents truncated
- Generic error messages (no info leakage)

---

### 4. Server → Database (Storage)
**Database:** SQLite (dev) / PostgreSQL (production)

**Tables:**
- `User`, `Profile` — Account data
- `Thread`, `Post` — Forum content
- `GrowDiary`, `DiaryUpdate`, `DiaryImage`, `DiaryFollow` — Grow tracking
- `GrowSetup`, `SetupImage`, `SetupComment` — Equipment showcases
- `ChatRoom`, `ChatMessage` — Community chat
- `DirectMessage` — Private messaging
- `Notification` — User alerts
- `Reaction`, `Follow`, `Block` — Social interactions
- `Badge`, `UserBadge`, `ReputationEvent` — Gamification
- `Report`, `ModerationAction` — Moderation
- `SecurityEvent`, `RateLimit`, `Captcha` — Security infrastructure
- `Strain`, `CalendarEvent`, `EnvironmentReading` — Content/reference

**Access Control:**
- Prisma ORM prevents SQL injection
- Parameterized queries throughout
- No raw SQL
- Database credentials in environment variables
- Production database should not be publicly accessible

**Privacy Controls:**
- Passwords hashed with bcrypt (12 rounds)
- IPs hashed (SHA-256 + salt)
- No sensitive data in plain text
- Foreign key constraints enforce data integrity

---

### 5. Database → Backups (Archival)
**Current:** No automated backups configured  
**Required for production:**
- Daily encrypted backups
- Point-in-time recovery
- Retention: 30 days recommended
- Access restricted to infrastructure team
- Secure deletion after retention period

**Privacy Controls:**
- Encrypt backups at rest
- Access logging for backup restoration
- Include deleted data in backups (for recovery)
- Purge old backups per retention policy

---

### 6. Third-Party Services (External)
**Currently:** None (no external services configured)

**Recommended:**
- **Image storage:** Cloudinary or AWS S3
- **Email:** SendGrid, Mailgun, or AWS SES
- **Monitoring:** Sentry, LogRocket, or DataDog
- **CDN:** Cloudflare or Vercel Edge Network
- **Redis:** Upstash or Railway (for rate limiting, caching)

**Privacy Controls for Third Parties:**
- Data Processing Agreements (DPAs) required
- Minimal data sharing (only what's needed)
- Encryption in transit and at rest
- Regular security assessments
- Vendor compliance verification

---

### 7. Logging & Monitoring
**Current:** `console.error` for errors, `SecurityEvent` table for security events

**Recommended:**
- **Error tracking:** Sentry or similar
- **Uptime monitoring:** UptimeRobot or Pingdom
- **Log aggregation:** Logtail or Datadog
- **Security monitoring:** Alert on suspicious patterns

**Privacy Controls:**
- Never log passwords, tokens, or session data
- Hash IPs before logging
- Truncate user agents
- No message content in logs
- Retain security logs for 90 days
- Access to logs restricted to security team

---

## Data Sharing Matrix

| Data Type | Public | Other Users | Moderators | Admins | Third Parties |
|-----------|--------|-------------|------------|--------|---------------|
| Username | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Email | ❌ No | ❌ No | ❌ No | ⚠️ Admin only | ❌ No |
| Password | ❌ Never | ❌ Never | ❌ Never | ❌ Never | ❌ Never |
| Posts/Threads | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Grow Diaries | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Direct Messages | ❌ No | ⚠️ Recipient only | ⚠️ On report | ⚠️ On report | ❌ No |
| Chat Messages | ⚠️ Room members | ⚠️ Room members | ✅ Yes | ✅ Yes | ❌ No |
| Reports | ❌ No | ❌ No | ✅ Yes | ✅ Yes | ❌ No |
| IP Address | ❌ Never | ❌ Never | ❌ Never | ⚠️ Hashed only | ❌ No |
| Location (if provided) | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Reputation | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Badges | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Follows | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Blocks | ❌ No | ❌ No | ❌ No | ⚠️ Admin only | ❌ No |
| Security Events | ❌ No | ❌ No | ❌ No | ✅ Yes | ❌ No |

---

## Data Retention Policy

### Immediate Deletion (on account deletion or user request)
- User profile (username, bio, location, website)
- User content (posts, threads, diaries, setups, comments)
- Direct messages
- Chat messages
- Reactions, follows, blocks
- Notifications
- User badges
- Reputation events

### Retained for Security/Moderation (90 days)
- `SecurityEvent` records (login attempts, rate limits, suspicious activity)
- `Report` records (for moderation accountability)
- `ModerationAction` records (audit trail)

### Permanent (System Data)
- `Category` — Forum structure
- `ChatRoom` — Chat room definitions
- `Badge` — Badge definitions
- `Strain` — Community-contributed strain data (curated)

### Backups
- Encrypted backups retained for 30 days
- Deleted data included in backups (for recovery)
- Backups purged after retention period

---

## Privacy-Enhancing Features

### Implemented ✅
- **Email optional** — Not required for registration
- **IP hashing** — SHA-256 + salt, never stored raw
- **Password hashing** — bcrypt with 12 rounds
- **Account deletion** — Full cascade delete
- **Data export** — JSON export of all user data
- **Minimal data collection** — Only essential fields required
- **No third-party tracking** — No analytics or tracking pixels
- **HTTPS only** — Enforced via HSTS header

### Recommended ⚠️
- **Profile privacy controls** — Make profile fields private/followers-only
- **Diary privacy** — Private diaries visible only to owner/followers
- **Message encryption** — E2E encryption for direct messages
- **EXIF stripping** — Remove GPS metadata from uploaded photos
- **Notification preferences** — Granular control over alerts
- **Anonymous browsing** — Optional mode to hide online status
- **Data anonymization** — Option to anonymize content instead of deleting

---

## Compliance Checklist

### GDPR (General Data Protection Regulation)
- ✅ Right to access (data export endpoint)
- ✅ Right to erasure (account deletion endpoint)
- ⚠️ Right to rectification (profile editing exists, but could be improved)
- ⚠️ Right to restrict processing (block/delete functionality needed)
- ✅ Data minimization (only essential data collected)
- ✅ Privacy by design (secure defaults, minimal collection)
- ⚠️ Consent management (age verification only — expand for EU users)
- ⚠️ Data breach notification (incident response plan needed)

### CCPA (California Consumer Privacy Act)
- ✅ Right to know (data export)
- ✅ Right to delete (account deletion)
- ⚠️ Right to opt-out (no sale of data, but document policy)
- ✅ Non-discrimination (no penalties for privacy choices)

### COPPA (Children's Online Privacy Protection)
- ✅ Age verification (21+ required)
- ⚠️ Parental consent (N/A — adults only platform)

### Cannabis-Specific Considerations
- ⚠️ User-generated cultivation content may be illegal in some jurisdictions
- ⚠️ Photos may reveal location (EXIF stripping required)
- ⚠️ Legal disclaimers recommended
- ⚠️ Jurisdiction-specific age verification may be needed

---

## Data Flow Diagram

```
┌─────────┐
│ Browser │
└────┬────┘
     │ HTTPS (encrypted)
     ▼
┌─────────────┐
│  Next.js    │──┐
│  Frontend   │  │ CSP, HSTS headers
└────┬────────┘  │
     │ API calls │
     ▼           │
┌─────────────┐  │
│  Next.js    │  │ Session validation
│  API Routes │  │ Rate limiting
└────┬────────┘  │ Input validation
     │           │
     ▼           │
┌─────────────┐  │
│  Prisma ORM │  │ Parameterized queries
└────┬────────┘  │ No raw SQL
     │           │
     ▼           │
┌─────────────┐  │
│  Database   │  │ Bcrypt hashing
│  (SQLite/   │  │ IP hashing
│  PostgreSQL)│  │ Foreign keys
└────┬────────┘  │
     │           │
     ▼           │
┌─────────────┐  │
│  Backups    │  │ Encrypted (recommended)
│  (30 days)  │  │ Access restricted
└─────────────┘  │
                 │
┌─────────────┐  │
│  Security   │◀─┘
│  Events     │ Log security events
│  (90 days)  │ Hash IPs, no sensitive data
└─────────────┘
```

---

## Security Controls Summary

### Encryption
- ✅ In transit: HTTPS (required)
- ⚠️ At rest: Database encryption recommended for production
- ⚠️ Backups: Encryption required for production
- ✅ Passwords: bcrypt (12 rounds)
- ✅ IPs: SHA-256 + salt

### Access Control
- ✅ Authentication required for all mutations
- ✅ Authorization checks (ownership, role)
- ✅ Rate limiting on all POST endpoints
- ✅ Session management (JWT, HTTP-only cookies)
- ✅ CSRF protection (NextAuth default)

### Monitoring
- ✅ Security event logging
- ✅ Rate limit violations logged
- ✅ Authorization failures logged
- ⚠️ Anomaly detection (recommended)
- ⚠️ Uptime monitoring (recommended)

### Incident Response
- ⚠️ Security incident plan needed
- ⚠️ Data breach notification procedure needed
- ✅ Security event logging for forensics
- ⚠️ Backup restoration procedure needed

---

## Data Classification

### Public Data
- Forum posts, threads, comments
- Grow diaries, setups, strains
- Usernames, avatars, reputation, badges
- Chat room names, categories

### Private Data (User-Only)
- Email addresses
- Direct messages
- Blocked user lists
- Notification preferences (when implemented)
- Session data

### Restricted Data (Internal)
- Password hashes
- IP addresses (hashed)
- Security events
- Moderation actions
- Reports

### Confidential Data (Never Exposed)
- Passwords (hashed, never logged)
- Session tokens (HTTP-only cookies)
- Database credentials (environment variables)
- API keys (environment variables)

---

## Recommendations

### Immediate
1. Implement EXIF stripping for image uploads
2. Add privacy controls (profile visibility, diary privacy)
3. Create data retention policy document
4. Set up encrypted backups
5. Implement notification preferences

### Short-Term
6. Add profile privacy settings (public/followers-only/private)
7. Implement anonymous browsing mode
8. Add "download my data" UI (currently API only)
9. Create privacy policy page
10. Add cookie consent banner (if needed for EU)

### Long-Term
11. Implement E2E encryption for direct messages
12. Add data anonymization option (instead of deletion)
13. Regular privacy audits (quarterly)
14. Privacy impact assessments for new features
15. User privacy education resources

---

**Last Updated:** 2026-09-08  
**Version:** 1.0  
**Owner:** Development Team
