# Security & Privacy Audit

Companion to [`full-codebase-integrity-audit.md`](./full-codebase-integrity-audit.md). Evidence = direct source inspection; all conclusions VERIFIED unless noted.

> **RESOLUTION STATUS:** M-03 fixed (`canSeeDeal` is frozen-aware;
> spotlight already was — re-verified). L-01 fixed (single
> `roomAccessDecision`). L-03 fixed (`activeAuthor()` on forum/updates).
> M-04 fixed (export extended). L-07 re-verified NOT a defect —
> `Reaction_userId_diaryId_key` dedupes diary reactions and the route
> XOR-enforces one target + handles P2002. No new security or privacy
> issue was introduced; no boundary was weakened. See
> `post-p3-p5-integrity-reconciliation.md`.

## Security findings table

`ID | Severity | Area | Finding | Evidence | Exploit/Impact | Recommendation | Confidence`

| ID | Sev | Area | Finding | Evidence | Exploit/Impact | Recommendation | Confidence |
|---|---|---|---|---|---|---|---|
| M-03 | MEDIUM | Authorization | `unlockFrozen` kill-switch bypassed at two gates | `deals-access.ts canSeeDeal()` uses raw `viewer.xp`; `spotlight.ts` uses `CURED_XP`+streak marker; neither reads `unlockFrozen`. `hasUnlock`/`canAccessRoom`/`roomAccessInfo` all do. | Frozen member retains gated deals + spotlight eligibility. Rare (staff action) but contradicts documented semantics. | Route both through `hasUnlock` or include the flag in their predicates. | VERIFIED |
| L-01 | LOW | Authorization | Room-access predicate exists in 3 copies | `canAccessRoom`, `roomAccessInfo` (`chat-access.ts`), inline at `chat/rooms/route.ts:121-124` | Drift risk if one copy changes (e.g. new requirement) | Consolidate to one predicate returning access+reason | VERIFIED |
| L-07 | LOW | Data integrity | `Reaction @@unique([userId,postId])` can't dedupe diary reactions | `postId` nullable; Postgres NULLs are distinct; diary reactions carry `postId=NULL` | Concurrent toggles can double-insert → inflated reaction counts (display only; no XP) | Add a dedupe-safe unique (e.g. coalesced column or second unique on (userId, diaryId)) or accept app-level dedupe | VERIFIED |
| I-04 | INFO | Config | Room upserts re-assert thresholds on read | `chat/rooms/route.ts:56-82` upserts `requiredXp` constants every GET | A settings edit to a gated room silently reverts | Keep (intentional seed semantics) or move seeding to a boot task | VERIFIED |

**No CRITICAL or HIGH security findings.** Auth, session, IDOR, uploads, markdown, CSP, cron, and channel auth were all directly verified correct.

## Verified-positive security controls

| Control | Evidence | Status |
|---|---|---|
| Session revocation | `User.sessionVersion`; `isSessionValid(userId, token.sessionVersion)` on every session-validating route incl. low-level `getToken` paths (messages, rooms, staff/applications) | VERIFIED |
| Role checks | `requireStaff`/`requireModerator`/`requireAdmin`/`requireSupport` read `User.role` fresh from DB — never JWT-cached | VERIFIED |
| Admin surface | `admin/layout.tsx`: guests→sign-in, non-staff→`notFound()` (existence hidden); every admin API re-checks role | VERIFIED |
| Password/recovery | bcrypt user passwords; bip39 12-word recovery phrase bcrypt-hashed; shown once; recovery rotates `sessionVersion` | VERIFIED |
| Login uniformity | same error for unknown user vs wrong password; IP+username rate limits; `restricted` self-service uses identical generic failure | VERIFIED |
| Registration anti-bot | Turnstile when configured; refuses production without `TURNSTILE_SECRET_KEY`; math captcha dev-only | VERIFIED |
| Upload security | magic-byte sniff; sharp re-encode+metadata strip; 400KB data-URI cap; batch rollback; ref-protected delete across all image tables | VERIFIED |
| Markdown/XSS | escape-then-render; `https/http/mailto` allowlist; no protocol-relative/backslash; forward-progress tokenizer; `noopener noreferrer` | VERIFIED |
| External links | `containsExternalLink` + `isTrustedForLinks` gate; `enforceLinkTrust` strips untrusted links; `sanitizeEcho` strips URLs from bot echoes | VERIFIED |
| CSP | `default-src 'self'`; no unsafe-eval in prod; frame-ancestors none; object-src none; base-uri self; form-action self; enumerated img/connect/frame srcs | VERIFIED |
| Pusher auth | session+ban+rate-limit+`private-user-<id>` self-match+`private-chat-<room>` via `canAccessRoom` | VERIFIED |
| Cron auth | `CRON_SECRET` bearer required in prod; UA fallback dev-only; fail-closed | VERIFIED |
| IP handling | `hashIp` w/ `IP_HASH_SALT` for logs+limits; proxy-header trust opt-in envs with honest docs | VERIFIED |
| Service worker | caches static assets only; never API/auth/HTML | VERIFIED |
| Security events | `logSecurityEvent` on rate-limit breaches, reversals, staff actions | VERIFIED |
| Secret hygiene | `.env` gitignored; `.env.example` complete; no secrets in repo sweep | VERIFIED |

## IDOR / authorization matrix (mutation & sensitive-read routes)

| Route family | Auth | Ownership | Result |
|---|---|---|---|
| `profile` + `profile/sections/[id]` | session | `ownSection` double-verifies profile.userId + section.profileId | ✅ |
| `diaries/[id]` (+harvest,experiments,updates,export,intel,discuss) | session | `authorId===session.user.id` (intel/discuss/export owner-scoped; intel 404s non-owner) | ✅ |
| `setups`+`comments`, `strains/photos` DELETE | session | author or staff | ✅ |
| `messages` | token+isSessionValid | conversation membership; dmPolicy+blocks at creation | ✅ |
| `notifications` | token+isSessionValid | all mutations `where:{userId}` scoped | ✅ |
| `follows`/`blocks`/`bookmarks`/`saved-searches`/`reactions` | session | caller-scoped rows | ✅ |
| `forum/threads`+`posts` (+accept,follow) | session | author or mod; accept=thread author | ✅ |
| `moderation/*`, `admin/*` | requireModerator/Staff/Admin | fresh role; bounded bulk; logged | ✅ |
| `staff/applications` | token+isSessionValid+admin | admin only | ✅ |
| `diary-contest`, `contest` | session | own PUBLIC diaries/photos only | ✅ |
| `users/[username]/card`, `sections/[section]` | optional session | viewer-aware scoping, block check | ✅ |
| `go/[slug]` | optional session | gated deals server-checked before redirect | ✅ (M-03 nuance) |

No route was found trusting a client-supplied id without an ownership/role check.

## Privacy findings table

`ID | Data | Leak Path | Severity`

| ID | Data | Leak path | Severity |
|---|---|---|---|
| L-03 | banned-author thread existence | `forum/updates` threadCount/latest omits `activeAuthor()` → count can disagree with filtered forum list | LOW (inference only; no content) |
| M-03 | deal/spotlight eligibility | `unlockFrozen` not applied to `canSeeDeal`/`spotlight` | MEDIUM (permission, not data) |
| M-04 | omitted models in export | `UserAchievement`,`StrainPhoto`,`PollVote`,`Feedback`,image-URL rows,`BotEvent` absent from account export | MEDIUM (completeness) |
| — | private/unlisted diaries | checked every read path: discovery, aggregates, counts, sitemap, search, suggest, strains, setups, profiles, growers, stats, contests, discuss, announces, feed — all use `publicDiaryWhere`/`viewableDiaryWhere`/owner scope | ✅ no leak found |
| — | blocked users | `blockedUserIds`/`blockExistsBetween` in notify, suggest, growers, card, DM, mentions | ✅ |
| — | banned/suspended/bot | `activeAuthor()` on all public queries; profiles 404 | ✅ |
| — | private grow intel | `getGrowIntel` owner-scope; 404 oracle-safe | ✅ |
| — | public milestone opt-out | honored by stage/harvest/badge announces + rankable surfaces | ✅ |
| — | notification residue | purge paths on content delete/privacy loss; bot chat announcements purged + tombstoned | ✅ |
| — | online status | `hideOnlineStatus` respected where presence is shown | ✅ spot-checked |
| — | IP addresses | hashed with salt | ✅ |
| — | email | none collected (column dropped in migration) | ✅ |

## Derived-data / aggregate privacy

`community-stats.ts` enforces minimum cohort floors (`NUMERIC_MIN 5`, `LABEL_MIN 3`, `CROSS_MIN 10`) before emitting any aggregate — verified; public stats route uses `activeAuthor` + `publicDiaryWhere`. Strain aggregates count PUBLIC diaries only. Leaderboard/directory use `rankableProfile` (active author + not bot + not opted out).

## Residual risks accepted-by-design (documented, not defects)

- UNLISTED diaries are link-reachable by any viewer (product semantic, consistent everywhere).
- Profile pages are always discoverable by username (no "hide profile" flag exists — pseudonymous but discoverable). Product decision, not a bug; note if a hide-profile request arises.
- Public profile exposes owner-editable `businessName/businessUrl/location/website` fields — they are profile content by design.
