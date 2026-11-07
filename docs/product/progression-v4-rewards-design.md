# TerpTalk Progression V4 — Rewards Design

**Status:** Authoritative for the V4 rewards economy.
**Supersedes:** `docs/progression-v2-design.md` (mechanics), `docs/product/progression-v3-spec-2026-11.md` (social standing values). Both remain as historical documents.
**Baseline:** `feat/progression-v4-rewards` from `47b6379`.

---

## 1. Philosophy

TerpTalk rewards **becoming a better grower and a better community member** — not activity volume. Three rules govern every number in this document:

1. **Meaningful effort over activity volume.** XP pays for cultivation progress, documentation quality, knowledge that helps people, and verified milestones. It does not pay for post counts, like counts, or follow counts.
2. **Two currencies, two meanings.** **Growth XP** = development as a grower/contributor. **Standing** = community respect, earned only through *other members'* independent validation.
3. **No farmable loop pays meaningfully.** Every repeatable award sits under a daily/weekly cap, a peer gate, a quality bar, or a reversal path. Abuse controls are part of the economy, not an afterthought.

## 2. Architecture (unchanged)

- `ProgressionEvent` append-only ledger; `Profile.xp`/`Profile.standing` cached balances; `xp == SUM(ledger)` enforced by `findProgressionDrift()`.
- `MasteryProgress` per-track XP; `PendingXpReversal`/`PendingReversal` durable outbox; keyed idempotency with reinstate/locked semantics.
- Legacy `ReputationEvent`/`Profile.reputation` is **frozen** — no writers remain. `awardReputation` is dormant. Badge milestone stats now read `Profile.xp` (V4 fix — they previously read the frozen field and were unearnable).

## 3. XP economy (V4)

The V2/V3 table is retained with these changes. Full table lives in `src/lib/progression-config.ts` (`XP_TABLE`) — the single authoritative config; this document mirrors it.

### Changes in V4

| Change | From | To | Rationale |
|---|---|---|---|
| `FOLLOWER_GAINED` standing | 3 | **2** | Matches V3 spec; a follow is a low-cost signal weaker than a repost (2) and far weaker than an accepted answer (10). Peer-gated, per-grantor capped, reversible on unfollow. |
| `MOMENT_POSTED` in `MEMBER_DRIVEN_XP_TYPES` | absent | **added** | V3 oversight — moment XP now counts on the weekly board like every other self-earned XP type. |
| Deferred types in `MEMBER_DRIVEN_XP_TYPES` | `GUIDE_PUBLISHED`, `GUIDE_IMPROVEMENT`, `REPLICATION` present | **removed** | Deferred types can never pay; the list now matches what can actually award. |
| Quest `spread-the-love` | like 3 growers (5 XP) | **`document-the-day`** — diary update with a photo (8 XP, RECORDS) | Volume-liking was the most farmable quest; photo documentation is real grow evidence. |
| Quest `green-thumb` | receive 3 likes (10 XP) | **`tend-the-experiment`** — create/update an experiment (10 XP, EXPERIMENTATION) | Receiving likes is passive and popularity-shaped; experiment care fills the only mastery path with zero quest coverage. |
| Quest payout copy | "+N reputation" | "+N XP" | Cosmetic correctness — payouts were always XP. |
| Milestone badges (12) | stat `reputation` (frozen at 0) | stat `xp` | Badges were permanently unearnable; XP thresholds preserve the intended cadence (150 XP ≈ Seedling, 7 000 ≈ Trained, 23 000+ = post-rank pursuit). |

### Unchanged core values (verified, retained)

- Diary creation 15 XP (cap 3/day); updates 5–23 XP/day via band stacking (`UPDATE_DAY`+`UPDATE_RICH`+`UPDATE_EXCEPTIONAL`+`STRUCTURED_CATEGORY`+`METRIC_FIRST`), soft-capped at 5 paid updates/day.
- Stage transitions 15/25/40 XP once per diary; harvest cluster ~155 XP once per completed grow.
- Forum: thread 8 (cap 3), reply 2 (cap 10), substantive answer 4 (cap 5, ≥200 chars), newcomer reply 3.
- `ACCEPTED_ANSWER` 30 XP + 10 standing (cap 2/day, peer-gated); `OP_CURATION` 5; `NEWCOMER_ACCEPT_BONUS` 10 XP + 2 standing.
- `ONBOARDING_COMPLETE` 15 once; quests ~15–35 XP/day + 5 perfect-day; weekly challenges ~90 XP/week; streak markers are 0-XP unlock anchors only.
- Mastery weekly soft cap: 250 XP full → 500 at ½ → tail at ¼, per track. Peer-gated standing types exempt.

## 4. Standing economy (V4)

Retained controls (all enforced inside `evaluateStandingAward`):

- Grantor age ≥ 24 h, grantor standing ≥ Trusted(100) floor (else halved), reciprocal-window zeroing, per-grantor lifetime cap 30, 90-day repeat ×0.5, cluster-concentration discount (>60% of a member's trailing-90d standing from one grantor → 0 + `AbuseFlag`), per-source-type weekly cap 20, member-driven weekly ceiling 40.

| Event | Standing | Notes |
|---|---|---|
| `ACCEPTED_ANSWER` | 10 | strongest peer signal; cap 2/day |
| `NEWCOMER_ACCEPT_BONUS` | 2 | helping newcomers specifically |
| `CONTEST_WEEKLY_WIN` / `MONTHLY_WIN` | 10 / 20 | staff-validated |
| `REFERRAL` | 15 | referee must earn 25 XP + be 24 h old |
| `REPOST_RECEIVED` | 2 | amplification of someone's moment |
| `FOLLOWER_GAINED` | **2** (was 3) | durable follow, unfollow reverses |
| `COMMENT_RECEIVED` | 1 | per qualifying comment (remaining-engagement checked on delete) |
| `*_REACTION_RECEIVED` (4 types) | 1 | per content surface |

**Deferred by design (documented, not wired):** `REPORT_UPHELED` (+5), abuse-flag penalties, `STANDING_RECOVERY`, `STAFF_GRANT` standing. The constants exist; wiring report-resolution standing is scheduled for the next iteration — it needs report-semantics review (RESOLVED ≠ upheld) before awarding. Do not award standing for report filing volume.

## 5. Mastery tracks

Five tracks, unchanged: CULTIVATION, RECORDS, KNOWLEDGE, EXPERIMENTATION, COMMUNITY ("Presence" in UI). V4 quest changes give EXPERIMENTATION its first daily-quest coverage and keep all five paths reachable without diary ownership (KNOWLEDGE via answers/strain-sourcing; COMMUNITY via social validation).

Rank diversity floors still require 2–3 mastery paths at higher rungs — a pure-lurker cannot rank up; a pure socializer cannot pass Flowering without cultivation or knowledge XP.

## 6. Rank ladder & unlocks

13 ranks, thresholds unchanged: 0 / 60 / 180 / 420 / 900 / 1 600 / 2 600 / 4 000 / 5 800 / 7 500 / 12 000 / 17 000 / 23 000.

Simulation (§8) shows early ranks arrive in days (correct — onboarding energy), mid ranks in weeks, and 12 000+ spans months. Unlocks are all **implemented** features: profile sections/stat slots (Seed→Cured), saved searches (Germinated→Trained), showcase capacity, quest slots (Rooted→Cultivator), diary insights, rate-limit boost, poll creation/voting, images-per-post, slowmode exemption. Standing-gated perks (extra links, showcase emphasis) remain standing-driven — trust, not grind.

No unlock was added that the code does not enforce; no free/safety-critical capability was moved behind XP.

## 7. Anti-abuse (verified controls, V4 deltas)

- Daily/weekly caps per type; mastery soft caps; duplicate-content simhash (≥95% withheld) on replies and diary updates; quality bands gate update XP; peer gates on every standing award; 24 h grantor age; reciprocal/cluster/follow-ring discounts.
- Velocity flag at 300 repeatable-XP/24 h → moderator review surface.
- Reversal completeness (V4 fixes): moment delete (owner + moderator), moment-comment delete with remaining-engagement check, repost toggle-off — all enqueue durable reversal intents in the deletion transaction and drain post-commit.
- Actor takedown sweeps `ACTOR_GRANTED_TYPES` — now includes all seven V3 social types; outbox fixpoint checks the identical list (`FIXPOINT_ACTOR_TYPES = ACTOR_GRANTED_TYPES`, single source of truth).
- Account deletion/bans preserve self-earned XP (deliberate) while clawing back everything the member *granted* others.

## 8. Economy simulation

`scripts/economy-sim.mts` models eight member profiles against the live `XP_TABLE` + cap/soft-cap rules (deterministic, no DB). Run: `npx tsx scripts/economy-sim.mts`. Results are embedded in the implementation report; assumptions: 30-day months, quests completed at ~70% rate, mastery soft cap applied weekly, standing capped at 40/week member-driven.

## 9. Compatibility & migration

- **No reset required.** All changes are prospective: `FOLLOWER_GAINED` pays 2 for *new* follows; historical 3-standing grants stand (documented, accepted).
- Badge repointing is prospective — badges check current `xp` on next `checkBadges` run; no grants are revoked.
- Quest slug changes orphan at most 7 days of old-slug payouts; the daily reconcile sweep non-finally reverses any whose live-row criteria no longer hold.
- `backup-progression.mts` now exports a consistent single-transaction snapshot with SHA-256 manifest + `--verify`; `reset-progression-v3.mts` requires `CONFIRM_RESET=yes` + `RESET_TARGET=<derived id>` and verifies all six affected tables post-wipe. Neither was executed.

## 10. Explicit non-goals

- No new ledgers, no paid advantages, no XP-for-sale, no engagement-bait quests, no changes to safety/moderation permissions.
- Legacy reputation system left frozen (reversal infra retained for historical rows).
- `Achievement`/`UserAchievement` framework remains dormant — badges carry accomplishment recognition; utility lives in rank unlocks. No duplicate system introduced.
