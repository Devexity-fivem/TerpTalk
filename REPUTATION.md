# Reputation 2.1

TerpTalk's community trust and progression system. Every point has a reason,
every award is traceable, and anything important is reversible.

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

## Tiers

`REP_TIERS` — 9 tiers, each with a real enforced benefit:

| Tier | Threshold | Benefit |
|---|---|---|
| Seed | 0 | — |
| Sprout | 250 | Sprout Ring frame; links don't need the new-member wait |
| Rooted | 750 | Rooted Band frame, custom titles, poll voting |
| Grower | 1,500 | Greenhouse Glow frame, Evergreen theme, auto Verified Member (+1.5× rep) |
| Cultivator | 3,500 | LED Bloom frame, Golden Hour theme, 1.5× rate limits |
| Master Grower | 7,000 | Pistil Fire frame, Midnight Garden theme, slowmode exempt, 6 images/post |
| Head Grower | 15,000 | Amber Jar frame, Deep Water theme, 2× rate limits, 8 images/post, 7 tags |
| Hash Maker | 40,000 | Rosin Ring frame, Amber Cure theme, legendary titles |
| Cannabis Deity | 100,000 | Northern Lights frame, Deity Glow theme — top of the ladder |

Perks are enforced in code via `getTierPerks()` / `repRateLimit()` — never
just advertised. `checkTierChange` notifies on tier-up; `demoteIfNeeded`
strips Verified Member if rep falls back under the threshold.

### Grow Stages

Tiers are sparse, so `TIER_STAGE_CHECKPOINTS` defines sub-stages inside each
tier gap (grow-cycle names: Germ → Veg → Flower → Flush → Harvest → Cure).
`REP_LADDER` is the flat list of all rungs — 30 total — and `getRepStage()` /
`getStageProgress()` / `getRepLevel()` derive a member's current stage and a
decorative Grow Level purely from the balance. Zero schema cost; reversals
demote stages automatically.

### Cosmetics

`lib/cosmetics.ts` (Prisma-free) holds three registries — avatar frames,
preset profile titles, profile card themes — each unlocked at a tier
threshold. `Profile.avatarFrame`/`profileTitle`/`profileTheme` store only the
equipped key; `PATCH /api/profile` validates equips with `canEquip()`.
`UserBadge.pinned` drives the badge showcase (slots scale with tier via the
`showcaseSlots` perk).

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

## Anti-abuse

- **Prevention**: self-awards blocked, TerpBot can never earn, banned/suspended
  recipients skipped, keyed dedupe, per-type daily caps, 24h liker-age floor,
  contest voter gates, one-vote-per-period unique indexes.
- **Detection**: `/api/admin/reputation/flags` surfaces velocity spikes
  (excluding contest wins, staff adjustments, referrals, and challenge
  payouts), reciprocal like pairs, reciprocal accepted answers, and likes
  from brand-new accounts. Detection only — nothing auto-punishes.
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
under the velocity flag). `evaluateChallenges()` runs inside `/api/ping`'s
~15-minute throttle; `GET /api/challenges` is owner-only.

## User-facing surfaces

- Profile header: tier chip, progress bar, tier benefit.
- Profile card: recent public reputation history (`PUBLIC_REP_TYPES` only —
  staff adjustments and check-in cadence stay private).
- `/reputation` — public explainer: sources, points, caps, tiers, fair play.
- `/api/users/[username]/reputation` — paginated public history.
- Milestone notifications (`notifyOnMilestone` preference) for tier-ups,
  badges, referral payouts, and staff adjustments — never per-point noise.
