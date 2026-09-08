# TerpTalk Security Test Plan

Manual + automated test cases for security verification. Run against staging; never run destructive tests on production data.

## Authentication

| # | Test | Steps | Expected |
|---|------|-------|----------|
| A1 | Weak password rejected | POST /api/auth/register with `password: "1234567"` | 400 |
| A2 | Invalid username rejected | Register with `admin`, `a`, `user name!` | 400 |
| A3 | Captcha bypass attempt | Register without/ wrong captchaId+answer | 400 |
| A4 | Captcha replay | Reuse same captchaId twice | Second attempt fails |
| A5 | Age gate bypass | Register with `ageVerified: false`/missing | 400 |
| A6 | Login enumeration | Login with nonexistent vs existing user | Identical error message & timing |
| A7 | Credential stuffing | 15 rapid logins for one username | 429 after 10 |
| A8 | Registration flood | 10 rapid registrations from one IP | 429 after 5 |
| A9 | Session expiry | Use 7+ day old JWT | Rejected |
| A10 | Password in response | Inspect register/login responses | No password field |

## Authorization (IDOR / BOLA)

| # | Test | Expected |
|---|------|----------|
| B1 | Create diary update with another user's diaryId | 403 "Unauthorized" |
| B2 | GET /api/profile without session | 401 |
| B3 | DELETE /api/profile as other user | Impossible — deletes own only; verify confirmUsername required |
| B4 | Reply to locked thread | 403 |
| B5 | Modify another user's post via crafted request | 403 (no edit endpoint exists yet — verify on implementation) |
| B6 | Access /api/chat/messages unauthenticated | 401 |
| B7 | Role escalation via request body `role: "ADMIN"` | Ignored — role never accepted from client |

## Data Exposure

| # | Test | Expected |
|---|------|----------|
| D1 | Inspect GET /api/chat/messages JSON | No `password`, `email`, `role`, `lastSeenAt` in author objects |
| D2 | Inspect thread page HTML/RSC payload | Same — no sensitive user fields |
| D3 | Inspect feed/diary/setups pages | Same |
| D4 | GET /api/profile/export as another user's id | Only returns own data (session-bound) |
| D5 | Error responses | Generic messages, no stack traces/paths |

## XSS / Injection

| # | Test | Expected |
|---|------|----------|
| X1 | Post content `<script>alert(1)</script>` | Rendered as literal text |
| X2 | Username `<img onerror=...>` | Rejected by regex |
| X3 | Bio with `<a href=javascript:...>` | Escaped |
| X4 | Chat message with HTML | Escaped |
| X5 | Thread slug crafted with SQL chars | Parameterized — no effect |
| X6 | `categoryId` nonexistent | 404 Category not found |

## Rate Limiting

| # | Test | Expected |
|---|------|----------|
| R1 | 35 chat messages in 1 min | 429 after 30 |
| R2 | 15 posts in 10 min ok; 31+ | 429 after 30 |
| R3 | Rate limit survives server restart | Yes (DB-backed) |

## Headers

- `curl -I https://domain` — verify CSP, HSTS, X-Frame-Options: DENY, nosniff, Referrer-Policy, Permissions-Policy
- securityheaders.com grade target: A

## Privacy

| # | Test | Expected |
|---|------|----------|
| P1 | Export data contains only own data | Verify JSON |
| P2 | Delete account → content gone | Verify cascade; login fails after |
| P3 | SecurityEvent rows contain hashed IPs only | No raw IP |
| P4 | Logs contain no passwords/tokens | Grep logs |

## Automated (to implement)

```bash
# suggested: vitest + supertest or playwright
tests/
  auth.spec.ts       # A1-A10
  authz.spec.ts      # B1-B7
  exposure.spec.ts   # D1-D5
  ratelimit.spec.ts  # R1-R3
```

CI gates: `npm run lint`, `npm run build`, `npx prisma validate`, `npm audit --audit-level=critical`.
