# Reputation 3.0 — The Path to Master Gardener

TerpTalk's community trust and progression system. Every point has a reason,
every award is traceable, and anything important is reversible.

The ledger balance is the progression axis (it drives levels, tiers, and
unlocks). **Community standing** is a separate, stricter metric: a filtered
sum over peer-validated event types only — likes received, accepted answers,
referrals, contest wins, staff recognition. Self-driven activity advances
progression but cannot manufacture standing.

## Core model

`Profile.reputation` is the denormalized current balance. `ReputationEvent`
is the ledger: every row's `amount` counts toward the balance — always.
`reversedAt` and `reversalOfId` are audit metadata, not sum filters, so the
invariant is simply:

```
profile.reputation == SUM(ReputationEvent.amount) for that user
```

Ledger columns: `key` (unique idempotency token), `actorId` (who caused it),
`sourceType`/`sourceId` (what it was for), `reversedAt`/`reversalOfId`
(status + linkage), `reason`, `createdAt`.

`scripts/check-drift.mts` verifies the invariant on demand.

## Earning

Defined in `src/lib/reputation-config.ts` (`REP_POINTS`, `REP_CAPS`).

| Source | Points | Limit | Notes |
|---|---|---|---|
| Thread created | +10 | 3/day | reversed if thread deleted |
| Reply created | +2 | 10/day | reversed if post deleted |
| Diary created | +10 | 2/day | |
| Diary update | +3 | 5/day, once per diary per day, 10+ chars | key-deduped |
| Strain added | +10 | 5/day | |
| Strain photo | +3 | 5/day | reversed if photo removed; no pay on self-created strains |
| Grow setup | +8 | 2/day | |
| Like received | +2 | 50/day | one like per liker per target, for life; liker account must be 24h+ old |
| Accepted answer | +30 | 2/day | reversed if unaccepted or deleted |
| Referral | +25 | per referred user | pays only after referee earns 25 rep and is 24h+ old |
| Daily check-in | +1 | once/day | hidden from public history |
| Budshot of the Week | +50 | per week | contest win |
| Diary of the Month | +150 | per month | contest win |
| Weekly challenge | +10–20 | per challenge per week | fixed roster, keyed `challenge:<week>:<slug>:<userId>` |
| Daily quest | +5–10 | per quest per day | 2–4/day from a deterministic rotation (slots scale with tier), keyed `quest:<day>:<slug>:<userId>` |
| Perfect day | +5 | once/day | all daily quests done, keyed `quest-day:<day>:<userId>` |
| Garden streak | +10–500 | once per milestone | consecutive daily check-ins; milestones at 3/7/14/30/60/100/365 days, keyed `streak:<days>:<userId>` |
| Harvest logged | +15 | once per diary | first false→true harvest transition only |
| Onboarding complete | +10 | once ever | profile-completion award, keyed |

Verified members get a 1.5× floor bonus (a +1 stays +1; +2 → +3) once the
account is 30+ days old.

Awards go through `applyReputationAward()` — synchronous, transactional,
idempotent by `key`. Past the cap the action still succeeds, it just stops
paying rep. `awardReputation()` wraps it and defers tier/badge/referral side
effects via `after()`.

## Reversals

`reverseReputationEvent()` appends a `REVERSAL` counter-entry for the
actually-applied delta (clamped to the current balance) and marks the
original `reversedAt`. Re-awarding a reversed key creates a `REINSTATE`
row that exactly compensates prior deductions. Everything is idempotent —
repeat calls are no-ops.

Automatic reversal triggers:

- Reaction removed or switched → `reverseReputationByKey`
- Post/thread/diary/strain-photo deleted → `reverseReputationBySource`
- Accepted answer changed → reversal of the old, award to the new
- User permanently banned → reverses awards they *caused* (likes they gave)
- Staff reversal → `POST /api/moderation/reputation`

## Tiers — the Path to Master Gardener

`REP_TIERS` — 13 ranks, each with real enforced perks. Early rungs are
dense so new members feel progression within days; the badge-aligned spine
(150/500/1500/3500/7000/15000/30000/50000) is preserved so milestone badges
still line up.

| Rank | Threshold | Unlocks |
|---|---|---|
| Seed | 0 | — |
| Germinated | 50 | Seed Shell frame |
| Sprout | 150 | Sprout Ring frame; links don't need the new-member wait |
| Seedling | 300 | Leaf nameplate (username styling in chat/forum), first titles |
| Rooted | 500 | Rooted Band frame, more titles, poll voting AND poll creation |
| Veg Grower | 1,000 | 3rd daily quest slot, Canopy Weave frame, Dawn Patrol theme |
| Grower | 1,500 | Verified Member (+1.5× rep), Greenhouse Glow frame, Evergreen theme |
| Bloom | 2,500 | Violet nameplate, animated Photon Pulse frame, Ultraviolet theme |
| Cultivator | 3,500 | The Grow Room chat, LED Bloom frame, Golden Hour theme, 1.5× rate limits |
| Master Grower | 7,000 | Pistil Fire frame, Midnight Garden theme, glowing nameplate, slowmode exempt, 6 images/post |
| Head Grower | 15,000 | The Vault chat, 4th daily quest slot, 2× rate limits, 8 images/post, 7 tags |
| Grandmaster | 30,000 | Rosin Ring frame, Amber Cure theme, tri-color nameplate, legendary titles |
| Master Gardener | 50,000 | Animated Northern Lights frame, Aurora Crown theme, golden nameplate, 10 images/post |

Perks live on `TierPerks` (`trustedLinks`, `pollVoting`, `pollCreation`,
`verifiedMember`, `rateLimitBoost`, `slowmodeExempt`, `imagesPerPost`,
`maxThreadTags`, `showcaseSlots`, `questSlots`, `nameplate`) and are
enforced in code via `getTierPerks()` / `repRateLimit()` / perk-threshold
helpers (`TRUSTED_LINKS_REP`, `POLL_VOTING_REP`, `POLL_CREATION_REP`) —
never just advertised, never indexed by ladder position. `checkTierChange`
notifies on tier-up; `demoteIfNeeded` strips Verified Member if rep falls
back under the threshold.

## Milestones & celebrations (2.2)

Every award's deferred pipeline (`postAwardEffects`) walks the ladder with
`crossedRungs(oldRep, newRep)` — a pure function returning each rung crossed,
classified `"tier"` or `"stage"` with the Grow Level landed on.

- **Tier-up** — `checkTierChange`: prominent notification carrying
  `metadata.kind = "tier"` (tier chip data + the cosmetics that just
  unlocked), plus the TerpBot lounge announcement.
- **Stage-up / Grow Level-up** — `checkStageChange`: one light notification
  per rung with `metadata.kind = "stage"` and the member's next locked
  cosmetic as the hook.
- **Once-ever** — each celebration is claimed by a keyed zero-amount
  `MILESTONE` ledger row (`milestone:tier:<uid>:<threshold>`,
  `milestone:stage:<uid>:<rung>`). The unique key makes dedupe durable and
  race-safe; `amount: 0` keeps `balance == SUM(amount)`. Reversals demote
  the level but re-earning a rung never re-fires its celebration.
- **Delivery** — `metadata` rides the normal notification row and the
  Pusher `new-notification` DTO. `navigation.tsx` already re-dispatches it
  as `tt-new-notification`; the global `MilestoneCelebration` listener
  (mounted in `providers.tsx`) renders a celebratory card — big for tier
  unlock chips, compact for stages, chips for badge/challenge events.
  Ordinary rep events carry no `metadata.kind` and stay silent. Everything
  is CSS-animated, `role="status"`, Escape/dismiss accessible, and
  client-deduped by notification id.
- **Badge unlocks** — `checkBadges` attaches `metadata.kind = "badge"` with
  each earned badge's name/rarity/icon.
- **Challenge completion** — `evaluateChallenges` attaches
  `metadata.kind = "challenge"` with titles + total reward.
- Contest wins and staff adjustments now run the same milestone pipeline
  (`awardReputation`/`runPostAwardEffects`), so a contest win that crosses
  a rung celebrates properly.
- **Demotion pruning** — `postDemotionEffects` (reversals + negative staff
  adjustments) clears equipped cosmetics the member no longer qualifies for
  and unpins showcase badges beyond the current tier's slot count.

### Grow Stages

Tiers are sparse, so `TIER_STAGE_CHECKPOINTS` defines sub-stages inside each
tier gap (grow-cycle names: Germ → Veg → Flower → Flush → Harvest → Cure).
`REP_LADDER` is the flat list of all rungs — 33 total — and `getRepStage()` /
`getStageProgress()` / `getRepLevel()` derive a member's current stage and a
decorative Grow Level purely from the balance. Zero schema cost; reversals
demote stages automatically.

### Cosmetics

`lib/cosmetics.ts` (Prisma-free) holds three registries — avatar frames,
preset profile titles, profile card themes — each unlocked at a tier
threshold. `Profile.avatarFrame`/`profileTitle`/`profileTheme` store only the
equipped key; `PATCH /api/profile` validates equips with `canEquip()`.
`UserBadge.pinned` drives the badge showcase (slots scale with tier via the
`showcaseSlots` perk). Flat helpers (`nextLockedCosmetic`,
`cosmeticsUnlockedBetween`) power "next unlock" copy and tier-up reward
chips. Equipped frames and titles render in chat message rows via
`chatAuthorSelect` — a dedicated select so cosmetics never widen
`publicUserSelect`. TerpBot never renders cosmetics (`!isBot` gate).

## Badges

`BADGE_REGISTRY` (badge-registry.ts) is the single source of truth — each
entry carries a `category` and, for stat-based badges, a structured
`progress` spec. `BADGE_RULES` in reputation.ts is GENERATED from those
specs so the grant rule and the UI progress bar can never disagree.
`seedBadges()` syncs registry rows into `Badge`. Earning paths:

- Stat/tier badges — `BADGE_RULES`, evaluated by `checkBadges()` after
  every award. Idempotent via `grantBadge()` (P2002-safe).
- `Dedicated Grower` — 7-day update streak, granted by the diary updates route.
- Contest honours (`Weekly Winner`, `Diary of the Month`, `Contest Finalist`)
  — `contest-awards.ts` at period resolution.
- `Beta Tester` — admin toggle; `Verified YouTuber` — admin YouTuber approval.
- `Moderator`/`Staff` — granted on role promotion, revoked on demotion.
- `Early Supporter` — first 250 registered members (member-number rule).
- `Trusted Member` — whitelisted admin grant (`STAFF_AWARDED_BADGES`).
- `BOT_BADGE_REGISTRY` — TerpBot-only achievements from `BotEvent` rows;
  never awardable to humans.
- **Hidden badges** — registry entries with `hidden: true` render as "???"
  on `/api/achievements` until earned (no name, description, or progress
  leaks). They're checked inside `checkBadges`/`postAwardEffects` like any
  other badge.
- **Badge rep bonuses** — rare+ badges pay a one-time rep bonus on grant
  (`BADGE_BONUS` in config); revoking a badge reverses its bonus via the
  keyed ledger (`badge-bonus:<badgeId>:<userId>`), and re-earning reinstates.
- **Admin badge tools** — `POST /api/admin/users` `badge` action can grant
  or revoke any registered badge (not just the staff whitelist); every call
  writes a `BADGE_ADJUSTMENT` moderation action + `SUSPICIOUS_ACTIVITY`
  security event.

## Anti-abuse

- **Prevention**: self-awards blocked, TerpBot can never earn, banned/suspended
  recipients skipped, keyed dedupe, per-type daily caps, 24h liker-age floor,
  contest voter gates, one-vote-per-period unique indexes, accepted-answer
  acceptor maturity gate (the thread author must be 24h+ and 10+ rep to pay
  out `HELPFUL_ANSWER`), thread/strain content quality floors, harvest
  one-shot keying (re-toggling can't re-farm), chat badge counter capped per
  UTC day, diary-update rep clawed back when the day's last update is
  deleted, onboarding/quest keys are replay-proof.
- **Detection**: `/api/admin/reputation/flags` surfaces velocity spikes
  (excluding contest wins, staff adjustments, referrals, and challenge
  payouts), reciprocal like pairs, reciprocal accepted answers, directed
  accept concentration, referral concentration, and likes from brand-new
  accounts. Detection only — nothing auto-punishes.
- **Review**: moderator ledger view (`/api/moderation/reputation` GET),
  reputation history in the moderation user lookup, staff-action audit feed.
- **Reversal**: single-event reversal (mods; `STAFF_ADJUSTMENT` rows need an
  admin), source/actor bulk reversal on deletion and bans.
- **Adjustments**: admin-only `POST /api/admin/reputation`, bounded ±500,
  always writes a ledger row + `ModerationAction` + `SecurityEvent`. Negative
  adjustments are clamped to the current balance.

## Contests

`ContestVote.week` / `DiaryContestVote.month` are denormalized from the entry
at vote time; unique indexes enforce one vote per user per period. Switching
votes atomically replaces the row. Self-votes blocked, inactive/banned voters
and authors excluded, deterministic tie-break (votes then earliest entry).
Finalist badges are granted to top-5 non-winners idempotently.

## Leaderboards

All rankable surfaces use `rankableProfile()` (security.ts): not banned, not
suspended, not TerpBot. Deterministic `REPUTATION_ORDER` tie-breaks.

## Migration

`20261004000000_reputation_2_ledger` added the ledger columns/indexes,
denormalized contest vote periods, and inserted one `LEGACY_MIGRATION` row per
profile whose balance didn't match the ledger — preserving every existing
point. Idempotent (`legacy:<userId>` key, `ON CONFLICT DO NOTHING`).

`20261006000000_reputation_2_1_progression` added the cosmetic columns
(`Profile.avatarFrame`/`profileTitle`/`profileTheme`), `UserBadge.pinned`,
the `User.createdAt`/`Strain.createdById`/`ReputationEvent(userId,type,
createdAt)` indexes, and renamed the Seedling badge row to Rooted — existing
UserBadge assignments carry over untouched. All idempotent.

## Weekly challenges

`lib/challenges.ts` holds a fixed roster (never generated). Progress is
recomputed server-side from the ledger and contest-vote rows — deleted or
reversed activity stops counting automatically, and no progress table exists.
Payouts are keyed `challenge:<isoWeek>:<slug>:<userId>` (~65 rep/week max,
under the velocity flag). `evaluateChallenges()` runs in `/api/ping`'s
deferred `after()` block on the ~15-minute staleness cadence — off the
response path; `GET /api/challenges` is owner-only. Replies in your own
threads don't count toward reply-based challenges.

## Daily quests

`lib/quests.ts` — two quests per member per UTC day (3 at Veg Grower, 4 at
Head Grower via the `questSlots` perk), selected by hashing
`(dayKey, userId, slug)` over a fixed pool. No table, no cron: selection is
deterministic and progress is recomputed from live rows/ledger entries the
same way challenges are. Every quest requires distinct threads/members/days
or a peer action — there is no "post N replies" quest. Payouts are keyed
`quest:<day>:<slug>:<userId>` plus `quest-day:<day>:<userId>` for the
perfect-day bonus; `evaluateQuests()` runs beside `evaluateChallenges()` in
the `/api/ping` deferred block. Missed quests simply expire — no streak
pressure, no punishment. Quest state is owner-only (`/progress`,
`/api/progression`, TerpBot `/quests`).

## Garden streaks

`lib/streaks.ts` — consecutive UTC days with a `DAILY_LOGIN` check-in. The
streak is DERIVED from the ledger (distinct-day scan over non-reversed
check-ins), so there is no streak table to drift. `evaluateStreaks()` runs
in the same `/api/ping` deferred block and pays `STREAK_MILESTONES`
(3/7/14/30/60/100/365 days → +10/+25/+50/+100/+150/+250/+500) once-ever per
member via keyed `STREAK_BONUS` rows (`streak:<days>:<userId>`). A broken
streak loses nothing already earned — it just restarts the count, and
re-climbing pays only milestones beyond the personal best. The member gets
one `REPUTATION` notification per newly-paid milestone batch.

## Community standing (trust)

`TRUST_STANDINGS` in reputation-config.ts labels a filtered trust score —
the ledger sum over peer-validated types (`LIKE_RECEIVED`, `HELPFUL_ANSWER`,
`REFERRAL`, `CONTEST_*`, `STAFF_*`) only. `getTrustScore()` computes it;
labels run Unrooted → Known → Trusted → Respected → Pillar → Legend. It's
shown on `/progress`, the Your Garden panel, and TerpBot `/rep` — never as
a public ranking.

## User-facing surfaces

- Profile header: tier chip, progress bar, tier benefit.
- Profile card: recent public reputation history (`PUBLIC_REP_TYPES` only —
  staff adjustments and check-in cadence stay private).
- `/reputation` — explainer plus the session-gated **Your Garden** panel
  (`ProgressionPanel`): current level/stage/tier, stage + tier progress
  bars, next unlock, upcoming rungs, weekly challenge strip, recent badges.
  Backed by owner-only `GET /api/progression`.
- `/api/users/[username]/reputation` — paginated public history.
- Milestone notifications (`notifyOnMilestone` preference) for tier-ups,
  stage-ups, badges, challenges, referral payouts, and staff adjustments —
  never per-point noise.
- Chat message rows render the equipped avatar frame and preset title
  (humans only).
