# TerpTalk Security

## Security architecture

TerpTalk is a Next.js 16 application using the App Router. All security-sensitive operations run server-side in API route handlers. The client is trusted only for display and navigation.

- **Authentication**: username/password credentials via NextAuth.js v4, bcrypt password hashing, JWT sessions (7-day max age, HTTP-only `__Host-` cookies with `SameSite=strict`), and a per-user `sessionVersion` counter that invalidates sessions after password reset or recovery.
- **Session freshness**: the `session` callback queries the database on every request to confirm the user still exists, is not banned, and that the stored `sessionVersion` matches the token. The JWT `role` is also refreshed each call.
- **Authorization**: `requireAdmin()` / `requireModerator()` perform fresh database checks on every staff endpoint. Ownership checks are explicit for edit/delete actions. No endpoint trusts a stale `session.user.role` for destructive operations.
- **Rate limiting**: database-backed `rateLimit()` keyed by hashed IP and/or user ID. Applied to authentication, registration, posting, messaging, uploads, search, and staff actions.
- **Input validation**: all mutation routes validate types, lengths, enums, and ownership before touching Prisma. JSON body parse failures return 400 and do not fall through.
- **Content security**: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy` are set in `next.config.ts`.
- **User data exposure**: `publicUserSelect` returns only `id`, `name`, `image`, `role`, and `profile.username` for public author references. Passwords, recovery-phrase hashes, ban reasons, raw IPs, and email are never exposed.

## Threat model

The application is designed for a public cannabis-growing community and is assumed to be targeted by abuse, scraping, and low-to-moderate skill attackers.

- **Untrusted user input**: every request body, query string, file upload, and header is validated or sanitized server-side.
- **Account takeover**: brute-force is mitigated by per-username and per-IP login throttling. Recovery phrases are 12-word BIP39 mnemonics, hashed with bcrypt, and replaced after each successful recovery.
- **Privilege escalation**: staff checks use fresh DB role lookups, not JWT claims. Moderators cannot ban administrators or change administrator roles.
- **IDOR**: resource IDs are CUIDs, and ownership/staff checks are performed before any read or mutation.
- **XSS**: user content is rendered as React text nodes. The only `dangerouslySetInnerHTML` uses are JSON-LD structured data, which escape `<`, `\u2028`, and `\u2029`.
- **File uploads**: data URIs must match `data:image/(png|jpe?g|webp);base64,`; magic-byte verification is performed before storage; SVG is rejected. `storeImage` throws if Blob is not configured in production.
- **Open redirect / SSRF**: redirects use database-staff URLs or relative paths. External URLs are validated to `https://` before storage.

## Rate limiting

| Endpoint / action | Key | Limit | Window |
|---|---|---|---|
| Login | `login:<username>`, `login-ip:<ipHash>` | 10 / 30 | 15 min |
| Registration | `register:<ipHash>` | 5 | 15 min |
| Recovery | `recover:<ipHash>`, `recover-user:<username>` | 5 / 5 | 1 h |
| Posts / threads | `post:<userId>`, `thread:<userId>` | 30 / 10 | 10 min / 1 h |
| Messages / chat | `dm:<userId>`, `chat:<userId>`, `chat-read:<userId>` | 60 / 30 / 120 | 10 min / 1 min |
| Search / similar threads | `search:<ipHash>`, `similar-threads:<ipHash>` | 30 / 20 | 1 min |
| Profile updates | `profile-update:<userId>`, `profile-complete:<userId>` | 20 / 15 | 1 h |
| Reactions / follows / blocks / bookmarks | per-user keys | 60-120 | 10 min |
| Contest / diaries / setups / strains | per-user keys | 20-60 | 1 h - 1 d |
| Admin / moderation | per-staff keys | 10-60 | 1 h |

## Upload security

- Only raster image data URIs (`png`, `jpeg`, `webp`) are accepted.
- Declared MIME type is verified against actual magic bytes.
- Maximum encoded data URI length is 400,000 characters (~300 KB).
- SVG and executable payloads are rejected by the regex and magic-byte checks.
- Images are stored as public Vercel Blob objects. Uploaded EXIF metadata is **not stripped server-side**; this is a known privacy limitation. For maximum privacy, re-encode or strip metadata before upload.

## Incident reporting

Report security issues to the maintainers. Do not open public issues for undisclosed vulnerabilities. Include reproduction steps, affected routes, and impact.

## Known limitations

- **CAPTCHA**: the built-in server-side CAPTCHA is a basic arithmetic challenge. It slows casual automation but is not a strong bot deterrent. For high-abuse periods, add Cloudflare Turnstile or reCAPTCHA.
- **Image URLs**: `img-src` in the CSP currently allows any `https:` origin so external avatar/admin-affiliate images load. Consider proxying or allow-listing specific domains.
- **EXIF stripping**: not performed server-side.
- **Rate-limit storage**: `RateLimit` rows live in PostgreSQL and are opportunistically cleaned; extremely high-volume abuse can still generate load.
- **Real-time chat**: Pusher private-channel authorization is gated, but the public chat room is open to authenticated users.
