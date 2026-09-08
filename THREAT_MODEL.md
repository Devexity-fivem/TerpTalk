# TerpTalk Threat Model

## System Overview

TerpTalk is a cannabis-focused community platform with forums, grow diaries, real-time chat, user profiles, and user-generated content.

## Assets to Protect

### User Data (PII & Sensitive)
- User credentials (passwords, session tokens)
- User profiles (username, bio, location if provided)
- Direct messages (private conversations)
- Grow diary content (potentially incriminating in some jurisdictions)
- IP addresses (hashed for security logs)
- Account metadata (registration date, last seen)

### Platform Integrity
- Database integrity (no unauthorized modifications)
- User reputation system (prevent manipulation)
- Moderation decisions (prevent abuse of power)
- Content authenticity (prevent impersonation)

### Service Availability
- API uptime
- Database availability
- Real-time chat service
- File storage (when implemented)

## Threat Actors

### 1. Anonymous Internet Attackers
**Motivation:** Financial gain, notoriety, disruption  
**Capabilities:** Automated scanning, credential stuffing, DDoS  
**Targets:** Registration endpoint, login, public APIs  
**Mitigations:**
- Rate limiting on registration and login
- CAPTCHA on signup
- Input validation on all endpoints
- Security headers (CSP, HSTS, etc.)

### 2. Malicious Registered Users
**Motivation:** Spam, harassment, reputation manipulation  
**Capabilities:** Post spam, abuse chat, create multiple accounts  
**Targets:** Forums, chat, direct messages, reactions  
**Mitigations:**
- Rate limiting on all content creation
- Moderation tools (to be implemented)
- Report functionality (to be implemented)
- Block system (schema exists, needs implementation)

### 3. Compromised User Accounts
**Motivation:** Spam, social engineering, data theft  
**Capabilities:** Post as victim, send DMs, change profile  
**Targets:** Other users, account settings  
**Mitigations:**
- Password hashing with bcrypt
- Session management with JWT
- HTTPS enforcement
- Login rate limiting
- Account activity logging

### 4. Malicious Moderators
**Motivation:** Abuse of power, harassment  
**Capabilities:** Delete content, ban users, view reports  
**Targets:** Regular users, content  
**Mitigations:**
- `ModerationAction` logging (who did what, when)
- Role-based access control
- Principle of least privilege
- Audit trail for all moderation actions

### 5. Compromised Moderator/Admin Accounts
**Motivation:** Same as compromised user + elevated access  
**Capabilities:** Full platform control  
**Targets:** All users, all data  
**Mitigations:**
- Strong password requirements
- Optional MFA (recommended, not yet implemented)
- Shorter session lifetime for admins (recommended)
- Security event logging for admin actions
- IP/device notifications (recommended)

### 6. Automated Bots
**Motivation:** Spam, account creation, scraping  
**Capabilities:** Mass registration, content scraping, API abuse  
**Targets:** Registration, public content, API endpoints  
**Mitigations:**
- Server-side CAPTCHA on registration
- Rate limiting on all endpoints
- Input validation
- Monitoring for suspicious patterns

### 7. Scrapers
**Motivation:** Content harvesting, competitive intelligence  
**Capabilities:** Automated content download  
**Targets:** Public forum posts, grow diaries, strain database  
**Mitigations:**
- Rate limiting on GET endpoints (partially implemented)
- Terms of service prohibiting scraping
- Robots.txt
- Consider Cloudflare or similar CDN protection

### 8. Credential Stuffing Attackers
**Motivation:** Account takeover via breached password lists  
**Capabilities:** Automated login attempts  
**Targets:** Login endpoint  
**Mitigations:**
- Rate limiting: 10 attempts per 15 min per username
- Uniform error messages (don't reveal if username exists)
- Account lockout consideration
- CAPTCHA after N failed attempts (recommended)

### 9. Spam Operators
**Motivation:** Advertising, phishing, malware distribution  
**Capabilities:** Mass content creation, link spam  
**Targets:** Forums, chat, DMs, comments  
**Mitigations:**
- Rate limiting on all content creation
- Content length limits
- Link detection (recommended)
- New user restrictions (recommended)

### 10. Malicious File Uploaders
**Motivation:** Malware distribution, storage abuse, XSS via SVG  
**Capabilities:** Upload malicious files  
**Targets:** Image upload endpoints (not yet implemented)  
**Mitigations (REQUIRED before enabling uploads):**
- File type validation (whitelist: jpg, png, webp)
- MIME type verification (server-side, not client-provided)
- File size limits (e.g., 5MB max)
- EXIF metadata stripping (GPS, camera info)
- Image re-encoding (prevents polyglot attacks)
- Disable SVG (XSS vector)
- Randomized filenames
- Signed URLs for private content
- Virus scanning (ClamAV or cloud service)

### 11. Privilege Escalation Attackers
**Motivation:** Gain admin/moderator access  
**Capabilities:** Parameter tampering, role manipulation  
**Targets:** API endpoints, user roles  
**Mitigations:**
- Server-side role validation (never trust client)
- Role changes logged in `ModerationAction`
- No client-side role parameters accepted
- Explicit role checks on all protected endpoints

### 12. Database Extraction Attackers
**Motivation:** Steal user data, passwords, messages  
**Capabilities:** SQL injection, API abuse, backup access  
**Targets:** Database, backups  
**Mitigations:**
- Prisma ORM (parameterized queries, no raw SQL)
- Input validation on all parameters
- Database credentials in environment variables (not in code)
- Principle of least privilege for DB user
- Encrypted backups (when implemented)
- No direct database access from frontend

### 13. Session Theft Attackers
**Motivation:** Account takeover without credentials  
**Capabilities:** XSS, session hijacking, man-in-the-middle  
**Targets:** Session cookies, JWT tokens  
**Mitigations:**
- HTTP-only cookies (no JavaScript access)
- Secure flag on cookies (HTTPS only)
- SameSite cookie attribute
- HTTPS enforcement (HSTS)
- CSP to prevent XSS
- Short session lifetime (7 days)

### 14. Realtime Chat Abusers
**Motivation:** Spam, harassment, flooding  
**Capabilities:** Message spam, room flooding  
**Targets:** Chat rooms, direct messages  
**Mitigations:**
- Rate limiting: 30 messages per minute per user
- Content length limits (1000 chars)
- Message deletion by moderators
- Room-level moderation (kick, ban)
- Currently: HTTP polling (not true realtime)
- **Required:** Socket.io with authentication, room authorization

### 15. API Abusers
**Motivation:** Resource exhaustion, data scraping  
**Capabilities:** Automated API calls, parameter fuzzing  
**Targets:** All API endpoints  
**Mitigations:**
- Rate limiting on mutation endpoints
- Input validation (type checking, length limits)
- Generic error messages (no info leakage)
- Monitoring for unusual patterns
- API authentication required

### 16. Supply-Chain/Dependency Attackers
**Motivation:** Inject malicious code via dependencies  
**Capabilities:** Compromised npm packages  
**Targets:** `node_modules`, build process  
**Mitigations:**
- Lock file (`package-lock.json`) committed
- Dependency audit (`npm audit`)
- Minimal dependencies (only what's needed)
- Regular dependency updates
- Review package.json scripts for suspicious commands

## Attack Vectors

### Injection Attacks
- **SQL Injection:** Mitigated by Prisma ORM
- **NoSQL Injection:** N/A (using SQL database)
- **Command Injection:** No shell commands executed
- **XSS:** React escapes by default, CSP headers added
- **Template Injection:** No template engines used

### Broken Authentication
- **Weak Passwords:** Min 8 chars enforced
- **Credential Stuffing:** Rate limited (10/15min)
- **Session Hijacking:** HTTP-only cookies, HTTPS required
- **Password Reset:** Not yet implemented (recommended)

### Sensitive Data Exposure
- **Passwords:** Bcrypt hashed (12 rounds)
- **PII in URLs:** No PII in URLs
- **PII in logs:** IPs hashed, no passwords/tokens logged
- **API responses:** `publicUserSelect` prevents password/email leakage

### Broken Access Control
- **IDOR:** Server validates user owns resource before modification
- **Missing Auth:** All mutation endpoints check `getServerSession()`
- **Privilege Escalation:** Roles validated server-side
- **Horizontal Privilege Escalation:** Resource ownership verified

### Security Misconfiguration
- **Error Messages:** Generic, no stack traces in production
- **Security Headers:** CSP, HSTS, X-Frame-Options configured
- **Default Credentials:** Changed (NEXTAUTH_SECRET rotated)
- **Directory Listing:** Not applicable (Next.js)

### XSS (Cross-Site Scripting)
- **Stored XSS:** React escapes user content by default
- **Reflected XSS:** No user input echoed in URLs
- **DOM XSS:** No `dangerouslySetInnerHTML` used
- **Rich Text:** Not yet implemented (when added, MUST sanitize)

### Insecure Deserialization
- **JSON Parsing:** Native `JSON.parse()` is safe
- **Object Injection:** Prisma prevents mass assignment
- **Type Confusion:** Type checking on all inputs

### Using Components with Known Vulnerabilities
- **Dependencies:** Run `npm audit` regularly
- **Outdated Packages:** Update dependencies monthly
- **Vulnerable Libraries:** Monitor security advisories

### Insufficient Logging & Monitoring
- **Security Events:** Logged to `SecurityEvent` table
- **Failed Logins:** Logged
- **Authorization Failures:** Logged
- **Rate Limit Violations:** Logged
- **Admin Actions:** To be implemented (moderation logging)

## Privacy-Specific Threats

### User Identification from Content
**Threat:** Grow diary photos may contain GPS EXIF metadata revealing location  
**Mitigation:** Strip EXIF metadata during image processing (when uploads implemented)

### IP Address Exposure
**Threat:** IPs could be logged or exposed to other users  
**Mitigation:** IPs hashed before storage, never exposed to other users

### Email Harvesting
**Threat:** User emails could be scraped or leaked  
**Mitigation:** Email optional, never displayed publicly, not in API responses

### Message Content Exposure
**Threat:** Private messages could be exposed to admins  
**Mitigation:** Privacy policy required, access controls, audit logging

### Data Retention
**Threat:** Deleted data may persist in backups  
**Mitigation:** Document retention policy, backup encryption, regular purging

## Risk Assessment Matrix

| Threat | Likelihood | Impact | Risk Level | Mitigation Status |
|--------|-----------|--------|------------|-------------------|
| Credential stuffing | High | Medium | 🟡 Medium | ✅ Mitigated |
| Account takeover | Medium | High | 🟡 Medium | ✅ Mitigated |
| Spam/flooding | High | Medium | 🟡 Medium | ✅ Mitigated |
| Data breach | Medium | Critical | 🔴 High | ⚠️ Partial (encryption needed) |
| XSS | Medium | Medium | 🟡 Medium | ✅ Mitigated |
| SQL injection | Low | Critical | 🟡 Medium | ✅ Mitigated |
| Malicious uploads | Medium | High | 🔴 High | ❌ Not implemented |
| Insider threat | Low | High | 🟡 Medium | ⚠️ Partial (logging exists) |
| DDoS | Medium | High | 🟡 Medium | ❌ Needs CDN/WAF |
| Session hijacking | Low | High | 🟡 Medium | ✅ Mitigated |

## Recommendations by Priority

### Critical (Before Launch)
1. Implement Socket.io with authentication for real-time chat
2. Add image upload with EXIF stripping and malware scanning
3. Migrate to PostgreSQL (SQLite not production-ready)
4. Enable email verification for password reset
5. Set up HTTPS (required for secure cookies)

### High (First Month)
6. Implement report/moderation queue
7. Add block functionality enforcement
8. Implement direct messaging (with privacy considerations)
9. Add session management UI
10. Set up monitoring and alerting

### Medium (Ongoing)
11. Optional MFA for admins/moderators
12. Content sanitization for rich text (if added)
13. Automated security testing suite
14. Regular penetration testing
15. Security awareness training

## Compliance Considerations

- **GDPR/CCPA:** Right to access and deletion implemented
- **Cannabis laws:** Platform hosts cultivation content — ensure compliance in all jurisdictions
- **Age verification:** 21+ enforced, may need stronger verification for regulated areas
- **Data retention:** Document retention policy for legal compliance
