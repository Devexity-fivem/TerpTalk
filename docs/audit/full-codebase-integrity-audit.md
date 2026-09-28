# TerpTalk Full Codebase Integrity Audit

**Date:** 2026 audit · **Type:** read-only, whole-repository · **Auditor basis:** direct source inspection at HEAD

> **STATUS NOTE — RECONCILED.** Every finding in this document was resolved
> or dispositioned in the follow-up implementation pass. The authoritative
> current state is in **`post-p3-p5-integrity-reconciliation.md`** —
> M-01…M-06 closed, L-01/02/03/05/06/08 fixed, L-04 intentionally retained,
> L-07 re-verified as not-a-defect. This document is retained as the
> historical record of the audit itself.

## Repository State (VERIFIED)

| Item | Value |
|---|---|
| Branch | `progression-v2` |
| HEAD | `06b25e77019bef8ec01e86a6bb59856df824b6f3` |
| `origin/progression-v2` | `06b25e77019bef8ec01e86a6bb59856df824b6f3` (in sync) |
| `origin/master` | `0f28b6dca0dc1418e3b1047975036d49a818f153` |
| Merge base | `0f28b6dca0dc1418e3b1047975036d49a818f153` |
| Ahead of master | **3 commits** (Profile V2 P3, P4, P5 checkpoints) |
| Working tree | Clean — zero modified, zero untracked (except audit docs created by this task) |
| Tracked files | **630** |
| Migrations | 68 directories + `migration_lock.toml` |
| API routes | 106 under `src/app/api` + `/go/[slug]` + `/sitemap-index.xml` = **108 route.ts** |
| Pages | 79 `page.tsx`; ~53 other app files (layouts, loading, sitemap, robots) |
| Libraries | 123 files under `src/lib` |
| Components | 121 files under `src/components` |
| Scripts | 42 files under `scripts/` |
| Docs | 9 under `docs/` (pre-audit) |

---

## Executive Findings

**Overall verdict:** The codebase is in unusually disciplined condition. Authentication, authorization, privacy scoping, progression, TerpBot privacy boundaries, uploads, Markdown rendering, CSP, cron, and the deploy-migration gate were all directly verified against source and are correct and internally consistent. **No CRITICAL findings. No HIGH findings.** The audit found **6 MEDIUM** and **8 LOW** findings plus a documented set of intentional legacy surfaces.

The dominant theme of the findings is **divergent sources of truth inside Progression V2**: a perk engine that already ships capabilities the unlock registry still labels "future", an achievement-table split between V1 and V2, and two callsites that bypass the `unlockFrozen` kill-switch by inlining rank thresholds. None is user-harmful today; all three will confuse or silently break future phases if left unreconciled.

### Severity Summary

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 6 | M-01 … M-06 |
| LOW | 8 | L-01 … L-08 |
| INFORMATIONAL | 4 | I-01 … I-04 |

### Top findings (details in §Findings)

- **M-01 — Unlock registry vs. live perk engine contradiction.** `images-6`, `images-8`, `images-10`, `rate-1.5`, `rate-2` are `status:"future"` (documented as "intentionally deferred, never enforced, never grantable") while `progressionPerksFrom()` grants exactly those capabilities at exactly those ranks today — enforced live in `forum/posts`, `forum/threads`, `chat/messages`, and `progressionRateLimit`. Two sources of truth disagree about whether shipped features exist.
- **M-02 — Achievement-route unlocks read a dormant table.** `hasUnlock()`'s achievement branch queries `UserAchievement`, which is written only by the one-time `progression-v2-migrate.mts` archive step. Live badge grants write `UserBadge` (V1). Both achievement-gated unlocks are "future" today, so nothing breaks yet — when they activate, post-migration badge earns will never satisfy them.
- **M-03 — `unlockFrozen` bypassed at two callsites.** `canSeeDeal()` (deals gating) and `spotlight.ts` (Grower Spotlight eligibility) inline rank-XP thresholds instead of `hasUnlock()`, so the staff kill-switch that "suspends unlocks" does not actually suspend gated deals or spotlight eligibility.
- **M-04 — Account export has documented coverage gaps.** `/api/profile/export` omits `UserAchievement`, member-uploaded `StrainPhoto`, `PollVote`, `Feedback`, image URL references (`DiaryImage`/`PostImage`/`SetupImage`), and `BotEvent` attribution. For a pseudonymous-by-design product this is a completeness gap, not a secrecy gap.
- **M-05 — Browser-level verification is ephemeral.** The P5 browser QA (17 checks: owner/visitor/anonymous privacy, 320–1280px responsive) ran from a temp script that was never committed or registered in `scripts/master-tests.mts`. The registry itself disclaims browser coverage. Profile V2's privacy and responsive behavior has no durable regression gate.
- **M-06 — Two live badge systems, one dormant.** `checkBadges()` (V1, BADGE_REGISTRY) is still the live grant path via diary updates; it writes `UserBadge`, which `/api/achievements` reads. `Achievement`/`UserAchievement` exists only as the migration archive. The V2 "Achievement" tables are dormant plumbing.

---

## Architecture Map (VERIFIED)

```
Browser (RSC + client components)
  ├─ Server components: pages query Prisma directly (profile, diaries, forum…)
  ├─ Client components: fetch /api/* (chat, notifications, progression, search…)
  └─ Pusher client: private-user-<id> (notifications), private-chat-<roomId>

API layer (106 routes)
  ├─ Auth: getServerSession(authOptions) OR getToken+isSessionValid (equivalent)
  ├─ Staff: requireStaff / requireModerator / requireAdmin — fresh DB role reads
  ├─ Rate limit: rateLimit(key, n, ms) — DB-backed; progressionRateLimit scales by rank
  ├─ Privacy: publicDiaryWhere / viewableDiaryWhere / activeAuthor / blockedUserIds
  └─ Validation: per-route, manual, consistent maxLength/type checks

Server libraries (123 files)
  ├─ progression.ts      — V2 engine: keyed events, caps, Standing, reversals, perks
  ├─ progression-config.ts — XP table, ranks, masteries, STANDINGS, UNLOCK_REGISTRY
  ├─ reputation.ts       — V1 frozen ledger: reversals, drift, checkBadges (live),
  │                        award path dead outside test fixtures
  ├─ terpbot*.{ts}       — ~16.3k LOC deterministic bot: parser, commands, intel,
  │                        decisions, events, session, profile insights
  ├─ grow-intel.ts       — owner-scope context/snapshot/decision pipeline
  ├─ public-profile.ts   — ~1.2k LOC single public-profile DTO builder
  ├─ chat-access.ts      — room authorization (isPrivate + requiredXp + standing)
  ├─ notify.ts           — single notification choke point (blocks, prefs, dedupe)
  ├─ blob.ts             — magic-byte validation, sharp re-encode, ref-protected delete
  ├─ markdown.tsx        — escape-then-render, protocol allowlist, safe tokenizer
  ├─ security.ts         — shared where-fragments, IP hashing, link trust, roles
  └─ settings.ts / maintenance.ts / cron-claim.ts — ops plumbing

Data layer
  ├─ Prisma schema: 62 models, PostgreSQL, 68 migrations (chronological, safe)
  ├─ No Session/Account models — stateless JWT + sessionVersion revocation
  └─ Soft-delete: Thread/Post/GrowDiary (+ purge paths); hard delete elsewhere

Background
  ├─ vercel.json: one cron — /api/cron/terpbot daily (CRON_SECRET-gated, fail-closed)
  └─ Outbox drains: reputation-outbox + progression-outbox (pending reversals)

Deploy
  └─ vercel-build = prebuild-migrate.mjs (prod-only, fail-closed) → prisma generate → next build
```

**Layering assessment:** Sound. One noted pattern: `progression.ts` re-exports config symbols so routes import one module; `terpbot-intel-*` splits a large engine into focused modules. No circular imports detected in inspected paths. Client components never import server-only libs (spot-checked).

---

## Findings

### MEDIUM

#### M-01 — Unlock registry "future" rows contradict the live perk engine

- **Evidence:** `progressionPerksFrom()` (`src/lib/progression.ts:1127-1142`) grants `rateLimitBoost` (Harvested 1.5×, Cured 2×), `imagesPerPost` (Flowering 6, Harvested 8, Cultivator 10), `maxThreadTags` (Cured 7), `slowmodeExempt` (Pillar standing), `showcaseSlots` (3→14 ladder). Registry rows `images-6/8/10`, `rate-1.5`, `rate-2` (`progression-config.ts:387-417`) carry `status:"future"` — documented in-file as "intentionally deferred… Never enforced, never grantable."
- **Consumers verified:** `forum/posts` (images), `forum/threads` (tags), `chat/messages` (slowmode exemption), `progressionRateLimit` (rate boost), `achievements` + `profile` (showcase slots).
- **Impact:** The unlock catalog misrepresents five shipped capabilities as roadmap items; `hasUnlock("images-6")` returns `false` for a member who can already post 6 images. If a future phase wires `hasUnlock` into an enforcement surface for these ids, it would *deny* what the perk engine *grants*.
- **Remediation:** Either promote the five registry rows to live (the behavior is already enforced — perks, not hasUnlock, is the enforcement layer) or remove them and document that capacity perks are rank-derived, not unlock-gated. Decide which is the single source of truth.
- **Confidence:** VERIFIED. **Severity:** MEDIUM (correctness/source-of-truth; no user-facing breakage).

#### M-02 — `hasUnlock` achievement-route reads dormant `UserAchievement` table

- **Evidence:** `hasUnlock` (`progression.ts:1022-1028`) queries `prisma.userAchievement` for `spec.achievement`. The only writer is `scripts/progression-v2-migrate.mts:127` (one-time archive of V1 badges → LEGACY achievements). Live grants write `prisma.userBadge` via `checkBadges()` (`reputation.ts:1027`). `/api/achievements` also reads `userBadge`, not `userAchievement`.
- **Impact:** None today — both achievement-gated rows (`mentoring-tools` → "greenlight", `data-quality-insights` → "full-spectrum") are `status:"future"`. When either activates, a member who earns the badge post-migration will not satisfy the unlock — the check looks in the wrong table.
- **Remediation:** Before activating achievement-gated unlocks, unify: either point `hasUnlock` at `userBadge` or add a live writer that mirrors V1 grants into `UserAchievement`.
- **Confidence:** VERIFIED. **Severity:** MEDIUM (latent defect, currently dormant).

#### M-03 — `unlockFrozen` bypassed by two inlined-threshold callsites

- **Evidence:** `deals-access.ts` `canSeeDeal()` checks `viewer.xp >= threshold` — never `unlockFrozen` (the `/go/[slug]` route builds `viewer` without the flag). `spotlight.ts` checks `CURED_XP` + streak marker directly — never `unlockFrozen`. Every `hasUnlock` consumer and `canAccessRoom`/`roomAccessInfo` do check the flag.
- **Impact:** A member whose unlocks are frozen (staff kill-switch for unlock abuse) keeps rank-gated deal access and Grower Spotlight eligibility while losing rooms, quest slots, exports, sections. The kill-switch's documented semantics ("suspends unlocks") are not honored at these two gates.
- **Remediation:** Route both through `hasUnlock` (or add the flag to their inlined predicate). Low urgency — freezing is a rare staff action.
- **Confidence:** VERIFIED. **Severity:** MEDIUM (inconsistent enforcement of a security-adjacent control).

#### M-04 — Account export coverage gaps

- **Evidence:** `/api/profile/export` covers the core domains (profile, diaries+updates+harvests, threads, posts, follows, blocks, notifications, progression events, badges, custom sections, settings) but omits: `UserAchievement`, member-uploaded `StrainPhoto`, `PollVote`, `Feedback`, image URL references (`DiaryImage`, `PostImage`, `SetupImage`), and `BotEvent` rows attributed to the user.
- **Impact:** Export is not a complete account extract. For pseudonymous accounts this is completeness debt; it matters for data-portability expectations and future "delete my data" audits.
- **Remediation:** Add the omitted models (they're all userId-scoped — trivial queries).
- **Confidence:** VERIFIED (list inspection). **Severity:** MEDIUM.

#### M-05 — Browser-level QA exists only as an ephemeral artifact

- **Evidence:** The P5 browser QA (17 checks: owner/visitor/anonymous TerpBot card privacy, deferred fetch, 320/390/430/768/1280px overflow) ran from `scripts/.p5-qa.tmp.mjs`, which was deleted before the P5 commit and is absent from `scripts/master-tests.mts`. The registry itself notes "no browser/runtime coverage exists" for Pusher-in-browser and keyboard accessibility. Per `AGENTS.md`, tests must be registered in `master-tests.mts`.
- **Impact:** Responsive-layout and browser-rendered privacy regressions have no durable gate; verification must be re-run manually per release.
- **Remediation:** Commit a registered browser QA suite (Playwright already used) or accept the manual-verification burden explicitly.
- **Confidence:** VERIFIED. **Severity:** MEDIUM (testing gap).

#### M-06 — Dual badge systems: V1 live, V2 `Achievement` dormant

- **Evidence:** `checkBadges()` (V1 `BADGE_REGISTRY`) runs live on diary updates (`api/diaries/updates/route.ts:415`), writes `Badge`/`UserBadge`, announces via `announceBadges`. `Achievement`/`UserAchievement` are written only by the migration archive step; `/api/achievements` renders `userBadge` rows under "achievement" naming. Bot badges (`BOT_BADGE_REGISTRY` via `awardBotBadge`) are a third, correctly isolated path.
- **Impact:** The "Achievement" V2 tables are dormant plumbing; page naming says "achievements" while the backing store is the V1 badge ledger. Works correctly today; increases confusion cost for future progression work and is entangled with M-02.
- **Remediation:** Either retire `Achievement`/`UserAchievement` (keep V1 Badges as the live system) or complete the V2 cutover so achievements are the single store.
- **Confidence:** VERIFIED. **Severity:** MEDIUM.

### LOW

| ID | Finding | Evidence | Confidence |
|---|---|---|---|
| L-01 | Room-access predicate triplicated | `canAccessRoom` + `roomAccessInfo` (`chat-access.ts`) + inline check in `api/chat/rooms/route.ts:121-124`. Currently consistent; drift risk. | VERIFIED |
| L-02 | Dead exports | `unlockStates` (progression.ts, no callers outside tests); `getTrustScore`, `repRateLimit`, `checkBadgesOccasionally`, `getTierPerks` (reputation.ts, no callers). `runPostAwardEffects`/`postDemotionEffects` live only via `rep3-backfill.mts`. | VERIFIED |
| L-03 | `forum/updates` counts banned-author threads | Route filters `deleted:false` + `category.hidden:false` but not `activeAuthor()` — count/latest indicator can disagree with the forum list (which filters banned authors). Cosmetic enumeration divergence; no content leak. | VERIFIED |
| L-04 | Legacy abuse detectors can no longer fire | `REP_RECIPROCAL_PAIR`, `REP_NEW_ACCOUNT_LIKES` query frozen `ReputationEvent.LIKE_RECEIVED`; no new rows are written post-V2. Documented intentional in code; operationally dormant. | VERIFIED |
| L-05 | Security suite tolerates legacy name | `verify-security.cjs` regexes accept `repRateLimit` as a valid limiter pattern — stale alias tolerated in the static contract. | VERIFIED |
| L-06 | Stale schema comment | `StrainPhoto.imageUrl` comment says "data URI (client-resized)"; the route stores a Vercel Blob URL via `storeImage`. Comment only. | VERIFIED |
| L-07 | `Reaction @@unique([userId,postId])` doesn't cover diary reactions | `postId` nullable → Postgres NULL-distinct → no DB dedupe for `diaryId` reactions; the route's findFirst-toggle dedupes serially but concurrent requests can double-insert. Blast radius: reaction counts only (reactions award no XP). | VERIFIED |
| L-08 | Naming debt | `tierPerks` variable name (threads route) for V2 `ProgressionPerks`; `/api/achievements` renders V1 badges under "achievement" naming. Cosmetic. | VERIFIED |

### INFORMATIONAL

| ID | Finding |
|---|---|
| I-01 | `20260313000000_terpbot_events` sorts before `_init_postgres` — self-contained (no FK deps), harmless ordering oddity. |
| I-02 | `/ops` is a redirect-only page to `/admin` — intentional compat shim, correctly gated (404 for non-staff). |
| I-03 | `docs/audit/` contained six pre-existing audit/plan docs; this audit adds five more. Old docs are historical, not stale — they describe completed phases accurately enough for archaeology. |
| I-04 | `chatRoom` upserts in `api/chat/rooms` GET re-assert `requiredXp` constants — a settings edit to a gated room's threshold would be silently reverted on next read. Intentional seed-style behavior, but worth knowing. |

---

## Domain Reviews

### Security (VERIFIED — strong)

| Area | Result |
|---|---|
| Authentication | JWT-only (no Session/Account tables). `__Host-` prefixed cookies. `sessionVersion` checked by `isSessionValid` on every session-validating route — bans/suspensions/password changes revoke sessions immediately. Uniform login errors. Recovery: 12-word bip39 phrase, bcrypt-hashed, shows-once. |
| Registration | Turnstile required in production (math captcha refuses `NODE_ENV=production`); dev fallback documented. Per-IP + per-username rate limits. Referral attribution is idempotent. |
| Authorization | `requireStaff`/`requireModerator`/`requireAdmin` do fresh DB role reads (not JWT-cached roles). Admin layout hides the surface via `notFound()` for non-staff. Support role separated. |
| IDOR | Spot-checked every ID-bearing mutation: `profile/sections/[id]` double-verifies (profile.userId + section.profileId); diaries/setups/strains/experiments/`diary-contest` check `authorId === session.user.id`; `diaries/[id]/intel` returns 404 for non-owner (no existence oracle); notifications scope every mutation by `userId` in the where clause. |
| Rate limiting | DB-backed limiter on every mutation surveyed; `progressionRateLimit` scales by rank; anonymous endpoints keyed by `hashIp`; per-username caps on credential-adjacent endpoints. |
| Headers | CSP (no unsafe-eval in prod), HSTS+preload, X-Frame-Options DENY, nosniff, Permissions-Policy, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. `img-src` enumerates breeder hosts. |
| Markdown | Escape-then-render; protocol allowlist (https/http/mailto); no protocol-relative or backslash tricks; forward-progress-protected tokenizer; `rel="noopener noreferrer"`. `enforceLinkTrust` + `containsExternalLink` gate external links for untrusted authors. |
| Uploads | Magic-byte sniffing (not MIME trust), sharp re-encode + metadata strip, size cap, batch cleanup on partial failure, reference-protected deletion across all image-bearing tables. |
| Cron | `CRON_SECRET` required in production — unsigned requests 401; the forgeable vercel-cron UA is never trusted alone in prod. Claim/release idempotency via `Setting` rows. |
| Pusher | Channel auth: session + banned + rate-limit + `private-user-<id>` self-match + `private-chat-<roomId>` → `canAccessRoom`. |
| Service worker | Static-assets only; never caches API/auth/user HTML. |
| Security events | `logSecurityEvent` on rate-limit hits, reversals, staff actions — an audit trail exists. |

**No security finding above LOW.** One process note: turnstile/Pusher/blob all fail closed when unconfigured (registration refuses, Pusher degrades to polling, uploads refuse) — verified in code.

### Privacy (VERIFIED — strong)

| Boundary | Enforcement |
|---|---|
| Diary visibility | `publicDiaryWhere` (PUBLIC) on every discovery/aggregate surface; `viewableDiaryWhere` (PUBLIC/UNLISTED/own) on canonical reads; `canViewDiary` on detail loads. Verified across: diaries index, strain pages, setup pages, profile, growers dir, search, suggest, sitemap, community-stats, contest eligibility, discuss-thread creation, harvest announce, stage announce, feed. |
| Block system | `blockedUserIds`/`blockExistsBetween` applied: search suggest (post-cache), growers dir, user card, notify() choke point (actor↔recipient), DM creation, comment/mention paths. Centralized — one choke point for notifications, one helper for queries. |
| Hidden author | `activeAuthor()` (not banned, not suspended, not bot) applied to public queries incl. forum, search, diaries, profiles, sitemap, stats. |
| Inference leaks | Discuss-thread creation requires PUBLIC (`discuss/route.ts` — "only PUBLIC diaries… or the thread would leak the grow's existence"). Contest entry requires PUBLIC. Stage/harvest announcements re-validate `visibility:"PUBLIC"` at post time and honor `publicMilestoneOptOut`; visibility flips and deletes trigger `purgeDiaryAnnouncements` (bot chat residue cleanup + Pusher tombstones). |
| Owner-only | `getGrowIntel` enforces `authorId` + `scope:"owner"` at the query; `/diaries/[id]/intel` 404s non-owners; `/profile/terpbot` is session-owner only; `ownerInsights` never serialized for visitors; `PUBLIC_PROFILE_NO_STORE` headers on profile APIs. |
| Notification privacy | `notify()` checks recipient banned, notification prefs, blocks, self-action, time-window dedupe, link sanitization (`SAFE_LINK`). Notification purge paths exist for deleted/private content. |
| Search | Query-length caps, LIKE escaping, trigram indexes, viewer-agnostic unstable_cache + post-cache block filter + private/public Cache-Control split. |
| IP privacy | `hashIp` salts client IPs in logs/limits (`IP_HASH_SALT` env). |

**Residual gaps:** M-03 (frozen members keep deal/spotlight eligibility — a permission, not data, leak); L-03 (banned-author threads counted in `forum/updates` ticker — existence inference only).

### Data Integrity (VERIFIED — strong, with noted exceptions)

- **Dual ledger design:** `ReputationEvent` (V1, frozen — no award writes outside test fixtures) + `ProgressionEvent` (V2, live). `Profile.reputation` and `Profile.xp`/`standing` are derived balances; `findReputationDrift` + `findProgressionDrift` run daily in cron and whole-DB in the test gate.
- **Idempotency:** every progression write carries a unique `key` (P2002-safe); quest/challenge/streak payouts keyed per period; referral payouts reconciled (`reconcileReferralPayouts`); BotEvent claims use unique keys with release-on-failure; AbuseFlag dedupe per day+subject.
- **Reversals:** `reverseProgressionEvent/ByKey/BySource/ByActor` with clamped counter-rows (applied delta = min(original, current balance) so `balance == SUM(active)` holds); outbox tables + drainers make moderation-initiated reversals retryable; delete paths enqueue reversals for both ledgers.
- **Delete semantics:** Thread/Post/GrowDiary soft-delete (`deleted:true`) + notification purge + blob cleanup + progression reversal; account deletion is a comprehensive transaction (blob pre-collection, actor scrub, dual-ledger actor sweeps).
- **Account deletion coverage:** verified comprehensive — profile, custom sections, settings, diaries (with blob pre-collect), setups, strains attribution, posts/threads, follows, blocks, notifications, DM messages, progression/reputation ledgers (actor fields nulled for audit retention), achievements/badges, saved searches, referrals, applications, feedback, reports filed by/against, polls/votes, bookmarks, reactions, chat messages.
- **Exceptions:** M-04 export gaps; L-07 reaction NULL-unique gap.

### Progression V2 (VERIFIED — engine correct; registry inconsistencies M-01/M-02/M-03)

- XP table, 13 ranks, 5 mastery paths, Standing axis, weekly Standing ceiling + per-source caps + grantor floor + reciprocal discount + cluster detection — all verified in `progression.ts`/`progression-config.ts`.
- Anti-abuse: no self-award, bot-account exclusion, banned/suspended suppression, deferred-event suppression, daily/weekly XP caps, per-mastery soft caps, `unlockFrozen` kill-switch (consumed by `hasUnlock`, `canAccessRoom`, perks — but see M-03).
- Unlock registry: 40 entries, 26 live + 14 `future`. Live entries verified against real enforcement callsites: `quest-slot-4/5` (quests.ts), `saved-searches-10` (route cap), `export-tools` (diaries/export), `grow-room`/`the-vault` (chat-access standing floors), `members-deals`/`top-shelf-deals`/`early-access` (deals), `profile-sections-4/6/8`, `stat-slots-6/8`, `pinned-harvest` (rank+streak routes), `records-widget`, `owner-analytics`, `env-analytics`, `harvest-analytics`. `nextRankUnlock` correctly skips future rows.
- Reversals wired into moderation (bulk + individual) and delete paths via both outboxes.
- **Defects:** M-01 (perk engine ships 5 registry-"future" capabilities), M-02 (achievement table split), L-02 (`unlockStates` dead).

### Profile V2 (P0–P5) (VERIFIED — live and consistent)

- `public-profile.ts` builds the full DTO with strict selects, owner-vs-visitor diary scoping, block checks, `activeAuthor` upstream, `publicMilestoneOptOut` honored on rankable surfaces, `no-store` headers.
- P3 portfolio (grows/harvests/strains/experiments/equipment chips), P4 cards + discovery (`/growers` mastery filter M3+, `users/[username]/card`), P5 TerpBot owner insights (`terpbot-insights.tsx` deferred fetch, `profile/terpbot` owner-only, Recorded/Derived/Recommended sections) — all verified live and privacy-scoped.
- Custom sections: owner-scoped CRUD, `profileSectionLimit` + `PROFILE_SECTION_HARD_MAX`, markdown-rendered.
- Widgets (`records-widget`, `owner-analytics`) enforced via `hasUnlock`.

### TerpBot (VERIFIED — deterministic, privacy-bounded)

- ~40 commands, all with handlers in `terpbot-data.ts`; registry in `chat-commands.ts` splits public vs staff (slash-only); the NL mention parser can only resolve public commands — staff commands are unreachable via `@terpbot` text.
- Intel pipeline: `terpbot-intel-context.ts` enforces scope at the query (`scope:"public"` adds `publicDiaryWhere`; `scope:"owner"` adds `authorId`); `getGrowIntel` owner-scope; `terpbot-profile.ts` owner-scope aggregates for P5.
- Announcements: `sanitizeEcho` strips URLs/markup from echoed user text; claim-then-post BotEvent idempotency; visibility re-validated at post time; residue purge on privacy loss.
- Assists (`scanGrowAssists`, `scanDormantThreads`, `scanStaleDiaries`) are private notifications, not public posts — no public leak surface.
- `BotEvent` ledger powers truthful `/u/terpbot` stats; bot badges isolated from human grant paths.

### Moderation / Trust & Safety (VERIFIED)

- `requireModerator` gates; `logModAction` audit trail; bulk ops bounded (1–100 ids), reason-required, rate-limited; reversal enqueue to both outboxes; notification purge on deletes; image cleanup.
- Trust signals: 4 detectors — V2 velocity (ProgressionEvent), reciprocal-answers (ProgressionEvent), reciprocal-likes + new-account-likes (frozen ledger, dormant by design). Flags materialized with evidence snapshots, per-day dedupe, staff notified.
- Reports: priority derived from reason (not reporter-trusted); cases have statuses/priorities; staff-visible only.
- Restricted account self-service (`/api/restricted`): password re-verify, generic failure for wrong credentials or unrestricted accounts, dual rate limits.

### Chat (VERIFIED)

- Rooms: `general` auto-seeded; `grow-room` + `the-vault` seeded behind `grow_room_enabled` flag with canonical XP thresholds + standing floors from the unlock registry; listed as locked teasers (advertising) but `roomAccessInfo`/`canAccessRoom` gate reads, writes, commands, and Pusher channel auth uniformly.
- Messages: session-validated, link-trust enforced, slowmode with staff/Pillar exemption, edit/delete windows, soft-delete + tombstone events, prune job (3-day retention — `chat-cleanup`).
- DM: `dmPolicy` (EVERYONE/FOLLOWING/NONE) + `blockExistsBetween` enforced at conversation creation; message writes verify membership.
- Notifications fan out over `private-user-<id>` Pusher channels with DB fallback (poll).

### Background jobs (VERIFIED)

- Single Vercel cron (`/api/cron/terpbot`, daily): digests, tips, contest winners, weekly recognition, trust-signal materialization, drift scans (both ledgers), referral/quest/challenge reconciliation, outbox drains, session sweeps. Claim-based idempotency per period task; failures release claims for next-run retry.
- `pruneChatMessagesIfDue` opportunistically via `/api/ping`.

### Deploy/Config (VERIFIED)

- `vercel-build`: `prebuild-migrate.mjs` (VERCEL_ENV=production only, unpooled URL preference, stale-lock sweep, retry, exit-nonzero → build fails) → `prisma generate` → `next build`. Preview/local builds cannot migrate prod.
- `.env.example` documents every secret correctly; all `process.env.*` uses in src resolve to documented vars or platform-provided ones (`VERCEL_ENV`, `POSTGRES_URL_NON_POOLING`, etc.).
- `db-guard.mjs` refuses production endpoints for every mutation-capable script (`ALLOW_PRODUCTION_DB_TESTS=1` override documented as never-set-casually).
- Dependencies: all 16 runtime deps used (recharts→charts, emoji-picker→chat, profanity-guard→profanity, pusher/pusher-js→chat, sharp→blob, bip39→recovery, etc.). No unused or duplicated libraries found. `overrides` pins cookie + @auth/core (security patches).

### Tests (VERIFIED — real coverage; gap noted in M-05)

- 26 suites registered in `master-tests.mts` across fast (pure+static), full (HTTP+DB, release gate), slow (analytics). HTTP verification uses real routes; DB suites import `db-guard`, clean fixtures, assert invariants (`Profile.reputation == SUM(ledger)`).
- `verify-security.cjs` static invariants + `ui-contracts` structural checks + drift scan over the whole DB after all fixture suites clean up.
- Coverage quality is genuinely behavior-based (HTTP auth/privacy/ownership, real lib calls for parsing/decisions) — not source-string mirrors except for documented contract checks.
- **Gap:** no committed browser suite (M-05); no dedicated test for the perk/registry consistency (the bug this audit found — `ui-contracts` only asserts `status === "future"` refuses in `hasUnlock`, which is why M-01's divergence went unnoticed).

### Migrations (VERIFIED — safe)

- 68 migrations, chronologically consistent, all additive or intentional drops (`drop_beta_invites`, `drop_unused_tables`, `drop_unused_email`, `drop_email_digest_frequency`, garden_perks column drops — all named cleanup of shipped-then-retired features).
- One ordering oddity (`terpbot_events` predates init) is harmless — the migration is self-contained.
- `progression_v2` migration present and matches the current schema's V2 models.

### Frontend/UX (VERIFIED at code level; browser-verified behavior is unaudited at runtime)

- Design system: `ui/` primitives (card, tabs, stat-strip, empty-state, skeleton, toast, tooltip, tt-badge…) shared across pages; components consistently consume them. No duplicate near-identical component families found.
- All 121 components have ≥1 importer — no orphan components detected.
- Accessibility spot-checks: tabs use `role="tab"` + `data-tab-id` (P5 QA targeted them), dialogs/forms have labels, `terpbot-insights` has `aria-labelledby` sections, loading/empty/error states exist.
- `/reputation` page is fully V2-termed (Progression explainer) — no stale V1 tier copy.
- Service worker + `sw-register` prod-only, static-only.
- **Not runtime-verified in this audit:** actual rendered behavior at breakpoints, hydration, keyboard flows — covered historically by ephemeral QA scripts (M-05).

---

## Feature Status Matrix (abbreviated — full matrix in `feature-integrity-matrix.md`)

| Feature | Status | Reality |
|---|---|---|
| Forums/threads/posts/questions | LIVE | Full CRUD, follows, accept-answer, tags, polls (standing-gated), view tracking, soft-delete |
| Grow diaries | LIVE | Lifecycle + visibility + harvest + discuss-thread + env observations + nutrients + experiments + CSV export (unlock) |
| Profile V2 (P0–P5) | LIVE | Portfolio, cards, discovery, customization, TerpBot insights — privacy-complete |
| Progression V2 | LIVE | XP/mastery/Standing/unlocks/reversals — see M-01/02/03 |
| Legacy reputation | LEGACY — INTENTIONAL | Frozen ledger; reversal/drift/checkBadges live; award path dead in prod |
| TerpBot | LIVE | ~40 commands, owner intel, cron digests, assists, announcements, badges |
| Chat | LIVE | Rooms (incl. gated), Pusher, slowmode, prune, DM policy |
| Notifications | LIVE | 13+ types, single choke point, dedupe, prefs, purge |
| Search/discovery | LIVE | Threads/strains/users/tags/guides + suggest + saved searches (unlock-gated cap) |
| Deals/Garden Perks | LIVE | Partner/product gating via rank + early-access; `/go` click redirect |
| Contests | LIVE | Budshot weekly + diary monthly; PUBLIC-only entries; cron winners |
| Strain catalog | LIVE | Community submissions + seeded catalog + photos + breeder facets |
| Guides | LIVE | Staff-authored, published flag, edit history |
| Moderation/trust | LIVE | Queue, reports, cases, abuse flags, bulk ops, reversals, audit |
| Referrals | LIVE | Attribution + delayed payout + reconciliation |
| Quests/challenges/streaks | LIVE | Daily quests (unlock slots), weekly challenges, check-in streaks |
| YouTuber program | PARTIAL | Apply flow + admin review exists; scope unclear vs core product — flag for product review (see unfinished-features doc) |
| Feedback | LIVE | Member → staff queue |
| Notifications-2 | LIVE | The single notification system ("-2" is a migration-era name) |
| Onboarding | LIVE | Interests, follows, completion → XP |
| Account lifecycle | LIVE | Export (M-04 gaps), delete, restricted self-service, recovery phrase |
| Ops/Admin | LIVE | Admin command center (audit, manage, media, members, settings, staff apps, users, youtubers, affiliates, experiments, feedback, growth, retention, community, system) |
| Plant Doctor | LIVE | Problem wizard → symptom threads |
| Grow comparisons | FUTURE | Registry rows exist (`comparison-slot-2`, `comparison-multi`, `comparison-env` — all "future"); no compare UI/API found → approved roadmap, not broken |
| Grower Cockpit | FUTURE | Registry row "future"; member-home/getGrowIntel provides partial substrate |
| TerpBot alerts/watch | FUTURE | `terpbot-watch-basic`, `watch-advanced`, `watch-compound` — "future" rows, no scheduler found |

---

## Source-of-Truth Matrix

| Domain | Authority | Derived/cached | Reconciliation | Drift risk |
|---|---|---|---|---|
| Profile display | `Profile` + `ProfileSettings` JSON | `public-profile.ts` DTO per request (no-store) | none needed | low |
| XP/Standing | `ProgressionEvent` ledger | `Profile.xp`/`standing` balance | `findProgressionDrift` (daily cron + test gate) | low |
| Legacy rep | `ReputationEvent` (frozen) | `Profile.reputation` | `findReputationDrift` | frozen → none |
| Mastery | `MasteryProgress` rows | derived levels | award-time update | low |
| Unlocks | `UNLOCK_REGISTRY` + `hasUnlock` | `progressionPerksFrom` (parallel!) | **none — M-01** | **real** |
| Achievements | `Badge`/`UserBadge` (live) | `Achievement`/`UserAchievement` (archive) | **none — M-02/M-06** | **real** |
| Diaries | `GrowDiary` (+soft delete) | strain aggregates, counts | queries re-derive | low |
| Search | live queries + `unstable_cache` (60s) | post-cache block filter | TTL revalidate | low |
| Notifications | `Notification` rows | Pusher push DTO | poll fallback | low |
| Chat rooms | `ChatRoom` | upsert re-asserts constants | n/a | I-04 |
| Deals gating | `hasUnlock` + raw xp | `canSeeDeal` | **M-03** | frozen-bypass |
| Rates/limits | `RateLimit` rows | none | TTL windows | low |

---

## Core Values Alignment (full matrix in `core-values-alignment.md`)

| Value | Alignment | Notes |
|---|---|---|
| Privacy | ALIGNED | Visibility discipline everywhere; owner-only intel; residue purges |
| Pseudonymity | ALIGNED | No email field at all (dropped); username-first identity |
| Trust / anti-manipulation | ALIGNED | Standing floors, reciprocal discounts, cluster detection, outbox reversals, abuse flags |
| Auditability | ALIGNED | Dual ledgers, ModAction log, SecurityEvent log, BotEvent ledger, drift scans |
| Determinism | ALIGNED | TerpBot fully deterministic; no LLM; progression formulaic |
| Quality over volume | ALIGNED | Caps, per-diary-per-day limits, accepted-answer > reply-volume |
| No fake engagement | ALIGNED | No bot-written member content; assists are notifications, not posts |
| Least privilege | ALIGNED | Owner-scope queries; staff-role DB checks; mention parser can't reach staff commands |
| Usefulness | ALIGNED | Every shipped feature maps to a grower/community job |
| Cannabis identity | ALIGNED | Entire domain model is cultivation; no generic-social drift |
| Accessibility | PARTIAL | Structural a11y exists; no durable browser/a11y regression gate (M-05) |
| Maintainability | PARTIAL | Strong overall; real debt concentrated in V1/V2 overlap (M-01/02/06, L-01/02) |

---

## Release Readiness

> **Superseded by `post-p3-p5-integrity-reconciliation.md`** — all items in
> the action plan below were executed in the reconciliation pass; the
> current classification is `RELEASE READY WITH DOCUMENTED NON-BLOCKING DEBT`.

**Verdict (at audit time): `RELEASE READY WITH DOCUMENTED P3 ISSUES`**

Rationale: zero critical/high findings; all MEDIUM findings are internal consistency/completeness debt — none currently harms users or leaks data. The branch is ahead of master by the three Profile V2 checkpoints, all pushed, working tree clean.

**What separates development state from production state:** `master` (`0f28b6d`) lacks P3–P5; a release = merging `progression-v2` → `master`. Before that merge the findings below should be triaged; none is a hard blocker but M-01 should be decided (it's a one-word `status` change either direction).

### Action Plan

**MUST FIX BEFORE NEXT PRODUCTION RELEASE** — none. No blockers found.

**SHOULD FIX NEXT (before the next feature phase):**
1. M-01 — Decide perk-vs-registry source of truth; flip `images-6/8/10`, `rate-1.5`, `rate-2` to live or remove them (they describe shipped behavior).
2. M-02 — Unify achievement storage before activating `mentoring-tools`/`data-quality-insights`.
3. M-03 — Route `canSeeDeal` + spotlight eligibility through `hasUnlock` (or add `unlockFrozen` to their predicates).
4. M-04 — Extend export to omitted models (15-min change, big completeness win).
5. M-05 — Register the browser QA suite (or explicitly accept manual verification in AGENTS.md).

**CLEANUP QUEUE:**
- L-02 dead exports (`unlockStates`, `getTrustScore`, `repRateLimit`, `checkBadgesOccasionally`, `getTierPerks`)
- L-01 room-access predicate consolidation
- L-03 `activeAuthor()` on `forum/updates`
- L-05 `repRateLimit` alias in `verify-security.cjs`
- L-06 `StrainPhoto.imageUrl` comment
- L-07 add `diaryId` to a dedupe-safe unique or keep documenting app-level dedupe
- L-08 `tierPerks` naming; achievements-page naming vs V1 backing store
- M-06 decide Badge-vs-Achievement end state
- One-time scripts (`rep3-backfill`, `progression-v2-migrate`) — archive or document as ops-run artifacts after prod migration completes
- `docs/audit/` historical docs — mark superseded by this audit

**FUTURE ROADMAP (already-approved only):** grow comparisons, Grower Cockpit, TerpBot watch/alerts, community-evidence aggregates, guide-authoring unlock, challenge-creation, mentoring-tools, nutrient schedules, experiment templates/analysis, historical trends, saved-views, quick-log templates, custom reminders, dashboard-advanced — all correctly marked `status:"future"` in the registry.

---

*Supporting documents:* [`codebase-file-inventory.md`](./codebase-file-inventory.md) · [`feature-integrity-matrix.md`](./feature-integrity-matrix.md) · [`security-privacy-audit.md`](./security-privacy-audit.md) · [`dead-code-and-unfinished-features.md`](./dead-code-and-unfinished-features.md) · [`core-values-alignment.md`](./core-values-alignment.md)
