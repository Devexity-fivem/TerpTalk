# TerpTalk Privacy Policy

## Data we collect and why

TerpTalk is designed to be a username-only, pseudonymous community. We collect the minimum data needed to operate the platform:

| Data | Purpose | Storage |
|---|---|---|
| Username | Public identity, login, content attribution | `User.name`, `Profile.username` |
| Password hash | Authentication | `User.password` (bcrypt) |
| Recovery phrase hash | Account recovery | `User.recoveryPhraseHash` (bcrypt) |
| IP hash | Rate limiting, abuse detection, security events | `SecurityEvent.ipHash` (SHA-256 with salt) |
| User-agent (truncated) | Abuse investigation | `SecurityEvent.userAgent` (first 256 chars) |
| Profile fields (bio, location, website, grow details, business info) | Public/community profile | `Profile` table |
| Content (threads, posts, diary updates, setups, comments, messages, chat) | Community functionality | respective tables |
| Security events | Audit trail, abuse response | `SecurityEvent` |

We do **not** collect email addresses. The `email` field is absent from the schema.

## Pseudonymity model

Users interact by username only. Internal `User.id` CUIDs are used for relations and may appear in public author metadata for UI purposes (keys, moderation actions). Real names, email, phone numbers, or government IDs are never requested or stored.

## Data minimization

- Public author responses contain only `id`, `name`, `image`, `role`, and `profile.username`.
- Banned status, ban reasons, recovery-phrase hashes, and raw IPs are never returned to clients.
- Security-event metadata is restricted to safe identifiers and event types; free-form user content is not logged.

## Retention

- Security events are retained for 90 days and opportunistically cleaned by the `admin/security` endpoint.
- User-generated content is retained until the user deletes it or their account.
- Rate-limit rows expire per-window; no long-term IP retention.

## Account deletion

Deleting an account requires the current password plus typed username confirmation. Cascading `onDelete: Cascade` relationships remove the profile, posts, threads, diaries, setups, messages, notifications, reactions, follows, badges, reputation events, reports, blocks, and moderation actions tied to the user. Security events may retain the `userId` until the next cleanup cycle.

## Third parties

- **Vercel**: hosting, build environment, Vercel Blob image storage.
- **Neon**: PostgreSQL database hosting.
- **Pusher**: realtime chat private-channel subscription service (server-auth only).

No advertising, analytics, or error-tracking SDKs are loaded in the client bundle.

## IP and privacy handling

- The `X-Forwarded-For` header is used only to derive a per-request IP for rate limiting and security events.
- Vercel-specific or Cloudflare-specific platform headers are preferred when present.
- IPs are hashed with a salt (`IP_HASH_SALT` or `NEXTAUTH_SECRET`) before storage. Raw IPs are not persisted in the database.
- The `SecurityEvent` model stores hashed IPs and a 256-character user-agent snippet for up to 90 days.

## Your rights

You can export your data from the profile page. You can delete your account from the same page. For other privacy requests, contact the maintainers.

## Contact

For privacy questions or data requests, contact the TerpTalk maintainers.
