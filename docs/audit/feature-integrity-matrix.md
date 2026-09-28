# Feature Integrity Matrix

Companion to [`full-codebase-integrity-audit.md`](./full-codebase-integrity-audit.md). "Actually works?" reflects traced code paths (UI → API → service → DB), not tests-as-proof.

> **UPDATED (post-P3/P5 reconciliation):** the perk-engine capabilities
> (`images-6/8/10`, `rate-1.5/2`, poll rights, slowmode exemption) are now
> live registry rows — polls' "M-01-adjacent" note is resolved by the new
> `poll-vote`/`poll-create`/`slowmode-exempt` entries. Deals gating is
> frozen-aware; spotlight verified equivalent to `hasUnlock`. Reactions
> L-07 downgraded — DB dedupe exists via `Reaction_userId_diaryId_key`.
> Achievements surface confirmed reading V1 `UserBadge` — canonical.

Legend: ✅ verified complete · ⚠️ works with documented gap · 🔵 future/approved-but-not-built · 🕰 legacy-intentional.

## Core community

| Feature | User-facing? | Code | API | Schema | UI | Tests | Perms | Privacy | Gate | Works? | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Forums (threads/posts) | ✅ | forum libs | `forum/threads`,`posts` | Thread/Post/Tag | forum pages | forum-verify | members, mod tools | hidden categories, soft-delete, blocks | new-threads setting | ✅ | L-03 |
| Questions & accepted answers | ✅ | accept flow | `threads/accept` | Thread.acceptedAnswerId | question UI | forum-verify | author-only accept | — | — | ✅ | — |
| Polls | ✅ | poll comps | `polls/[id]/vote` | Poll/PollVote | poll.tsx | covered | create: standing gate; vote: standing gate | — | `pollCreation`/`pollVoting` perks | ✅ | M-01-adjacent (perks live, not registry rows — but polls aren't in registry) |
| Reactions | ✅ | reaction route | `reactions` | Reaction | diary/post UI | covered | members | notify respect blocks | — | ✅ | L-07 (NULL-unique race) |
| Follows (user/category/thread/diary) | ✅ | follows routes | `follows`,`categories/follow`,`threads/follow` | Follow/Follower | follow buttons | covered | members | follower lists scoped | — | ✅ | — |
| Blocks | ✅ | block UI | `blocks` | Block | blocked-members | self-service suite | members | enforced in notify/search/DM/cards | — | ✅ | — |
| Reports→cases | ✅ | report-button | `reports`, `moderation/*` | Report/Case/ModAction | moderation UI | trust-safety | members report; staff act | reports staff-only | — | ✅ | — |
| Saved searches | ✅ | saved-searches | `saved-searches` | SavedSearch | saved-searches comp | covered | owner-scoped | — | `saved-searches-10` unlock | ✅ | — |
| Bookmarks/saved threads | ✅ | bookmark-button | `bookmarks` | Bookmark | saved-threads | covered | owner-scoped | — | — | ✅ | — |

## Grows & cultivation

| Feature | User-facing? | Code | API | Schema | UI | Tests | Perms | Privacy | Gate | Works? | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Grow diaries | ✅ | diary libs | `diaries`+`[id]` | GrowDiary | diary pages | diary-verify | author CRUD; staff | PUBLIC/UNLISTED/PRIVATE everywhere | — | ✅ | — |
| Diary updates | ✅ | update-form | `diaries/updates` | DiaryUpdate | update UI | diary-verify | author | follows diary visibility | — | ✅ | — |
| Env/nutrient logging | ✅ | env fields | via updates | DiaryUpdate cols | forms/charts | covered | author | inherits diary | `env-analytics` unlock (charts) | ✅ | — |
| Harvests | ✅ | harvest-form | `[id]/harvest` | Harvest | shelf UI | covered | author | inherits + `yieldPrivate` | — | ✅ | — |
| Diary visibility control | ✅ | visibility select | PATCH diaries | GrowDiary.visibility | diary settings | self-service | author | announce purge on flip | — | ✅ | — |
| Discuss thread | ✅ | diary-discuss-btn | `[id]/discuss` | Thread link | diary page | covered | members | PUBLIC-only (no existence leak) | — | ✅ | — |
| Per-grow CSV export | ✅ | export route | `[id]/export` | — | UI button | covered | owner-only | owner-scope | `export-tools` unlock | ✅ | — |
| Grow experiments | ✅ | experiment-* | `diaries/[id]/experiments` | GrowExperiment(+updates) | cards/forms | covered | author CRUD; public read of public-diary experiments | inherits diary | EXPERIMENTATION mastery XP | ✅ | — |
| Grow setups | ✅ | setup-form | `setups`+`comments` | GrowSetup | setups pages | covered | author; comments members | public content | `SETUP_SHOWCASE` XP | ✅ | — |
| Plant Doctor | ✅ | problem-wizard | `threads/symptom` | symptom tags | wizard UI | covered | members | public threads | — | ✅ | — |
| Strain catalog | ✅ | strain libs | `strains`+`photos` | Strain/StrainPhoto | catalog/detail | strain-lifecycle | members submit; staff delete | public; photo owner/staff delete | `STRAIN_*` XP | ✅ | L-06 |
| Grow intel (cockpit panel) | ✅ | grow-intel | `[id]/intel` | derived | intel panel | terpbot suites | **owner-only 404** | owner scope enforced | — | ✅ | — |
| Grow comparisons | 🔵 | `grow-compare.ts` substrate | none | — | none | — | — | — | `comparison-*` rows all "future" | 🔵 approved roadmap | not built — correctly marked |
| Grower Cockpit | 🔵 | member-home partial | — | — | — | — | — | — | `grower-cockpit` "future" | 🔵 roadmap | not built |

## Identity & progression

| Feature | User-facing? | Code | API | Schema | UI | Tests | Perms | Privacy | Gate | Works? | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Auth (credentials+JWT) | ✅ | auth.ts | nextauth routes | User(+sessionVersion) | auth pages | account-verify | — | __Host-cookies, version revocation | — | ✅ | — |
| Recovery phrase | ✅ | recovery.ts | `auth/recover`,`profile/recovery` | User.recoveryPhraseHash | recover UI | self-service | — | bcrypt-hashed | — | ✅ | — |
| Progression V2 (XP/rank/mastery/Standing) | ✅ | progression.ts | `progression`,`ping` | ProgressionEvent/MasteryProgress/Profile | progress+profile | reputation/self-service | — | standing public on profile | caps/abuse guards | ✅ | M-01, M-02, M-03 |
| Unlocks | ✅ | unlock registry | via hasUnlock everywhere | — | reputation page, teasers | ui-contracts | — | frozen flag honored except M-03 | per-spec | ✅ | M-01 (5 rows stale), M-03 |
| Badges (V1) | ✅ | badge-registry/checkBadges | `achievements` GET | Badge/UserBadge | achievements page | reputation suite | grant via activity/staff | hidden badges hidden | — | ✅ | M-06 |
| Achievements (V2 table) | 🕰 | migrate script only | read by hasUnlock (dormant) | Achievement/UserAchievement | — | — | — | — | dormant | ⚠️ dormant plumbing | M-02, M-06 |
| Quests | ✅ | quests.ts | via ping eval | ProgressionEvent keys | quest board | rewards3 | members | — | `quest-slot-4/5` | ✅ | — |
| Weekly challenges | ✅ | challenges.ts | `challenges`, ping | ProgressionEvent keys | challenges UI | rewards3 | — | — | — | ✅ | — |
| Streaks | ✅ | streaks.ts | ping eval | streak markers | streak UI | rewards3 | — | — | streak→unlock route | ✅ | — |
| Journeys | ✅ | journeys.ts | eval path | JourneyState-ish | journey UI | rewards3 | — | — | — | ✅ | — |
| Weekly recognition | ✅ | weekly-recognition | cron | ProgressionEvent | boards | covered | — | opt-out honored | — | ✅ | — |
| Contests | ✅ | contest-* | `contest`,`diary-contest` | Contest entries/votes | boards | covered | members enter PUBLIC diaries/photos | public content | `CONTEST_*` XP | ✅ | — |
| Referrals | ✅ | referrals.ts | register attribution | Referral | signup UI | referral-integrity | members | delayed payout | `REFERRAL_*` thresholds | ✅ | — |

## Profile V2 (P0–P5)

| Feature | User-facing? | Code | API | Schema | UI | Tests | Perms | Privacy | Gate | Works? | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Public profile | ✅ | public-profile.ts | `users/[username]` | Profile | u/[username] | self-service | viewer-aware | banned/suspended→404, blocks, opt-outs | — | ✅ | — |
| Grow portfolio (P3) | ✅ | profile sections | `users/.../sections/[section]` | via diary queries | profile tabs | self-service | viewer-aware | PUBLIC-only to visitors | — | ✅ | — |
| Profile cards/discovery (P4) | ✅ | profile-card, growers | `users/[username]/card` | — | cards+/growers | covered | block-aware | M3+ directory, opt-out | — | ✅ | — |
| Customization (P2) | ✅ | profile-settings | `profile`,`sections` | ProfileCustomSection/ProfileSettings | customize page | self-service | owner-only write | section limits | `profile-sections-*`, `stat-slots-*` | ✅ | — |
| TerpBot insights (P5) | ✅ | terpbot-profile.ts | `profile/terpbot` | derived | insights card | self-service | **owner-only** | deferred fetch, no-store | — | ✅ | M-05 (no durable browser gate) |
| Avatar/banner | ✅ | blob.ts | `profile` PATCH | Profile fields | settings UI | security suite | owner | re-encoded+stripped | — | ✅ | — |
| Pinned/featured harvest&grow | ✅ | pinned logic | `profile` | Profile fields | profile | covered | owner | unlock+streak gate | `pinned-harvest` | ✅ | — |

## TerpBot

| Feature | User-facing? | Code | API | Schema | UI | Tests | Perms | Privacy | Gate | Works? | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Slash/mention commands | ✅ | terpbot-data | `chat/commands` | BotEvent | chat | parser+pipeline suites | members; staff cmds slash-only | public-scope queries | room access | ✅ | — |
| NL parser | ✅ | nl-parse/vocab/intents | internal | — | — | parser suite | — | — | — | ✅ deterministic | — |
| Grow intel engine | ✅ | terpbot-intel-* | `diaries/[id]/intel` | derived | panel | intelligence+decisions suites | owner-scope | enforced at query | — | ✅ | — |
| Proactive assists | ✅ | assist modules | cron | BotEvent | notifications | decisions suite | — | private notify only | — | ✅ | — |
| Announcements | ✅ | terpbot.ts | post paths | BotEvent | general room | pipeline suite | bot account | visibility re-check + purge | — | ✅ | — |
| Owner profile insights | ✅ | terpbot-profile | `profile/terpbot` | derived | P5 card | self-service | owner-only | owner-scope | — | ✅ | — |
| Watch/alerts | 🔵 | — | — | — | — | — | — | — | `terpbot-watch-*` "future" | 🔵 roadmap | not built |

## Communication

| Feature | User-facing? | Code | API | Schema | UI | Tests | Perms | Privacy | Gate | Works? | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Chat rooms | ✅ | chat-room | `chat/rooms`,`messages` | ChatRoom/ChatMessage | chat page | chat-ux suite | members; staff tools | slowmode, lock, prune | `grow-room`/`the-vault` gates + flag | ✅ | L-01, I-04 |
| Pusher realtime | ✅ | pusher libs | `pusher/auth` | — | live | runtime-verify | channel auth | private-* channels | room gate | ✅ | — |
| DMs | ✅ | messages UI | `messages` | Conversation/Message | messages page | account-verify | members | dmPolicy+blocks | — | ✅ | — |
| Notifications | ✅ | notify.ts | `notifications` | Notification | notif center | notification-2 suite | recipients | prefs/blocks/dedupe/purge | — | ✅ | — |
| Mentions | ✅ | mentions.ts | post paths | Notification | markdown | covered | — | notify choke | — | ✅ | — |

## Commerce/partners

| Feature | User-facing? | Code | API | Schema | UI | Tests | Perms | Privacy | Gate | Works? | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Deals/Garden Perks | ✅ | deals-access | `go/[slug]`, admin affiliates | AffiliatePartner/Product/Click | deals page | covered | public+gated | rank/early-access gates | `members-deals`,`top-shelf`,`early-access` | ⚠️ | M-03 (frozen bypass) |
| Grower Spotlight | ✅ | spotlight.ts | home render | derived | home | covered | — | opt-out/public-only | `grower-spotlight` (inlined) | ⚠️ | M-03 |
| YouTuber program | ⚠️ | youtubers pages | `youtubers/apply`, admin review | YoutuberApplication | program page | covered | members apply; admin reviews | — | — | ⚠️ scope-question | see dead-code doc |
| Staff applications | ✅ | staff apply | `staff/apply`,`applications` | StaffApplication | apply+admin | covered | members apply; admin | — | — | ✅ | — |

## Admin/Ops

| Feature | User-facing? | Verified |
|---|---|---|
| Admin command center | staff | layout 404-gate + per-route role checks; dashboards for users/members/media/audit/settings/features/affiliates/experiments/feedback/youtubers/growth/retention/community/system/terpbot |
| Moderation queue | staff | merged queue, priorities, bulk ops w/ dual-ledger reversals |
| Maintenance mode | staff | setting + staff bypass + `/maintenance` page |
| Ops metrics | staff | ops-metrics behind admin |
| Backup script | ops | `scripts/backup.ts` (db-guarded) |
| Deploy gate | platform | prebuild-migrate fail-closed |

## Counts

- Features audited: **46** rows above
- LIVE & verified: 39 · PARTIAL/works-with-gap: 4 · FUTURE (approved, correctly marked): 3 groups (comparisons, cockpit, watch) · Dormant plumbing: 1 (Achievement V2) · DEAD: 0 features · BROKEN: 0
