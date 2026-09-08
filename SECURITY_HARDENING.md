# TerpTalk Security Hardening Guide

Step-by-step hardening tasks for production deployment.

## Server & Runtime

- [ ] Enable HTTPS only (TLS 1.2+); redirect HTTP → HTTPS
- [ ] Set `NEXTAUTH_URL` to the production HTTPS origin
- [ ] Set unique, strong `NEXTAUTH_SECRET` per environment (32+ random bytes)
- [ ] Set unique `IP_HASH_SALT` per environment
- [ ] Rotate all secrets used during development
- [ ] Disable source maps in production (`productionBrowserSourceMaps: false` — already set)
- [ ] Ensure `NODE_ENV=production`

## Database

- [ ] Migrate from SQLite to PostgreSQL
- [ ] Restrict DB network access (private network / VPC only)
- [ ] Use least-privilege DB user (no superuser for app)
- [ ] Enable SSL for DB connections (`?sslmode=require`)
- [ ] Enable automated encrypted backups
- [ ] Test backup restoration procedure
- [ ] Run `npx prisma migrate deploy` (never `migrate dev` in prod)

## Authentication & Sessions

- [ ] Verify cookies are `Secure` + `HttpOnly` + `SameSite=Lax` (automatic with HTTPS NEXTAUTH_URL)
- [ ] Confirm session maxAge (currently 7 days — consider shorter for admins)
- [ ] Plan optional MFA (TOTP) for MODERATOR/ADMINISTRATOR roles
- [ ] Add session revocation endpoint (force re-login on password change)

## API & Abuse

- [x] Rate limiting on registration, login, content creation
- [ ] Extend rate limiting to GET endpoints (scraping defense)
- [ ] Add CAPTCHA trigger after N failed logins
- [ ] Consider WAF/CDN rules (Cloudflare) for edge filtering
- [ ] Add request body size limits (default Next.js limit is fine, verify)

## Security Headers

Configured in `next.config.ts`. For production, tighten CSP:
- Replace `'unsafe-inline'`/`'unsafe-eval'` in script-src with nonces
- Verify headers with https://securityheaders.com

## File Uploads (required before enabling)

- [ ] Whitelist extensions: jpg, jpeg, png, webp
- [ ] Verify magic bytes server-side (never trust client MIME)
- [ ] Max size: 5MB; dimension cap (e.g., 8192px) to prevent image bombs
- [ ] Re-encode images (strips polyglot payloads)
- [ ] Strip EXIF metadata (GPS, device info)
- [ ] Randomize storage filenames (no user-supplied names)
- [ ] No SVG (XSS vector)
- [ ] Antivirus scan (ClamAV or provider)
- [ ] Signed URLs for any non-public assets

## Logging & Monitoring

- [ ] Replace `console.error` with structured logging (pino/Winston → Logtail/Sentry)
- [ ] Never log: passwords, tokens, session cookies, message bodies, full request bodies
- [ ] Alert on: failed login spikes, rate-limit surges, registration anomalies, 5xx spikes
- [ ] Uptime monitoring for / and a health endpoint

## Dependencies

- [ ] `npm audit` — review critical findings (2 critical currently flagged)
- [ ] Pin versions; avoid `latest`/floating ranges
- [ ] Enable Dependabot or Renovate
- [ ] Verify lockfile integrity in CI

## Access & Admin

- [ ] No admin endpoints exist yet — when built: server-side role checks, MFA, audit logging of every action
- [ ] Separate admin credentials; never reuse personal accounts
- [ ] Reauthentication before destructive operations (ban, delete user)

## Privacy

- [ ] Publish Privacy Policy + Terms of Service
- [ ] Document data retention (see DATA_INVENTORY.md)
- [ ] Account deletion + export already implemented — expose in settings UI
- [ ] Do not expose emails, IPs, internal IDs in any API response (verified — `publicUserSelect`)
