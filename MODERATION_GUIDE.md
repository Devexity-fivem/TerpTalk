# TerpTalk Moderation Guide

## Roles

| Role | Can do |
|---|---|
| USER | Post, reply, react, report, block |
| MODERATOR | All user actions + view report queue, remove content, resolve/dismiss reports |
| ADMINISTRATOR | All moderator actions + ban/unban users, generate invites, view admin stats |

Moderators cannot act on admins or other moderators. Only admins can ban.
No one can take a moderation action on themselves.

## The report queue (`/moderation`)

Users can report: threads, posts, chat messages, profiles, diaries, setups.
Reasons: Spam, Harassment, Threats, Illegal content, Scam/phishing, Malicious links, Other.

Each queue entry shows: content type, reason, reporter username, optional description, and a preview/link to the reported content.

### Actions available per report

- **Remove content** — soft-deletes the reported thread/post/chat message (or hides diary/setup). Auto-resolves the report.
- **Ban user** *(admin only)* — permanently bans the reported account. Auto-resolves the report.
- **Resolve** — marks handled, no content action.
- **Dismiss** — invalid/spam report.

Every action is written to the **Moderation Log** (bottom of `/moderation`) and to `SecurityEvent` for audit.

## Ban enforcement

A banned user:
- Cannot log in (uniform "invalid credentials" — no ban disclosure)
- Cannot post, reply, create diaries/setups/strains, or send chat messages (403 "account suspended")
- Is hidden from public profile pages (404)

To unban: admin issues an `UNBAN` action via `POST /api/moderation/actions` (UI button coming post-beta).

## Escalation

- Threats/illegal content → remove content, then report to admin for ban + legal assessment
- Suspected account compromise → admin ban, then investigate via `SecurityEvent` records
- Moderator disagreement → admins can review the action log

## What we do NOT do

- We never expose reporter identity to the reported user
- We never act on a report without checking the actual content
- Bans are logged with reasons; unbans too
- No shadowbans — actions are visible in the log

## Content states

- `deleted: true` — soft-deleted; hidden everywhere, 404 on direct access; author/mod only path to removal
- `locked: true` — thread readable, no new replies (moderator/admin set via DB until UI ships)
- `banned: true` — account suspended
