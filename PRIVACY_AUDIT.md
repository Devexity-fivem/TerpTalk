# TerpTalk Privacy Audit

**Date:** 2026-09-08 · **Framework:** NIST Privacy Framework (Identify, Govern, Control, Communicate, Protect)

## Executive Summary

TerpTalk treats cannabis-cultivation content as **potentially identifying sensitive information** even where not legally classified as PII. Privacy controls implemented during this audit: data minimization (no email required), IP hashing, account deletion, data export, and removal of password/email exposure from all API responses.

## Identify — Data Map

Full field-by-field inventory: see `DATA_INVENTORY.md`. Key categories:

- **Identity:** username (required, public), email (optional, never displayed), password (bcrypt, never exposed)
- **Content:** threads, posts, diaries, diary updates, setups, chat messages, reactions — public by default
- **Private:** DirectMessage (schema only, not yet implemented), Block, Notification
- **Sensitive context:** grow diaries can reveal cultivation activity + location via photos (EXIF risk — upload feature not yet implemented)
- **Telemetry:** SecurityEvent (hashed IP, truncated UA, 90-day retention)
- **No third-party analytics, ads, or trackers.**

## Govern — Policies Needed

| Policy | Status |
|--------|--------|
| Privacy Policy page | ❌ Not written — required before launch |
| Terms of Service | ❌ Not written |
| Data retention schedule | ✅ Documented in DATA_INVENTORY.md (90d security logs, account-lifetime for content) |
| Moderator data-access rules | ⚠️ Models exist; no access UI yet — must publish rules before enabling moderator tooling |
| Backup retention | ❌ Not configured — required: 30d encrypted |

## Control — User Rights

| Right | Mechanism | Status |
|-------|-----------|--------|
| Access own data | `GET /api/profile/export` (JSON) | ✅ Implemented — needs settings-page UI button |
| Delete account | `DELETE /api/profile` (typed-username confirm, cascades) | ✅ Implemented — needs UI |
| Rectify data | `POST /api/profile/complete` (username/bio/location/website) | ✅ Implemented |
| Restrict visibility | — | ❌ No private/followers-only modes yet |
| Block users | `Block` model | ⚠️ Schema only — no endpoints/UI |
| Opt out of tracking | — | ✅ Nothing to opt out of (no trackers) |

## Communicate — Transparency Gaps

- No privacy policy, no community guidelines, no data-use disclosures. **Must publish before public launch.**
- Chat messages are room-visible and persisted — users should be informed.
- Grow-photo warning: when uploads ship, warn users that photos can reveal location; strip EXIF server-side.

## Protect — Technical Controls

- Passwords: bcrypt(12). Sessions: JWT, HTTP-only cookies, 7-day expiry.
- `publicUserSelect` guarantees no `password`/`email`/`role`/`lastSeenAt` in any API response (fixed across 13 files).
- Security logs hash IPs (SHA-256 + `IP_HASH_SALT`); never log passwords/tokens/message bodies.
- HTTPS enforced via HSTS header config; cookies auto-`Secure` when `NEXTAUTH_URL` is https.
- Registration: server-side CAPTCHA + IP rate limit (5/15min) + age attestation enforced.

## Privacy Risks Remaining

| Risk | Severity | Mitigation |
|------|----------|------------|
| Grow diary photos could expose GPS via EXIF | High | Upload feature not built — must strip EXIF at ingestion |
| Public-by-default content | Medium | Add diary/profile visibility settings |
| `User.status`/`lastSeenAt` presence fields exist but aren't updated | Low | Implement or remove before launch |
| Deleted-content retention in backups | Medium | Document 30-day backup purge; encrypt backups |
| Admin visibility into DMs (when built) | Medium | Restrict access + audit-log all reads |

## Launch-Blocking Privacy Actions

1. Publish Privacy Policy + ToS + community guidelines
2. Add settings UI: delete account + export data buttons
3. EXIF stripping before enabling image uploads
4. PostgreSQL migration with encrypted, access-controlled backups
