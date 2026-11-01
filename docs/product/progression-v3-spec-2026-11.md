# Progression V3 — "Growth & Standing" redesign

**Date:** 2026-11-01 · **Status:** implementation spec
**Mandate:** rebuild the progression system for the social-media +
cannabis-forum product thesis; reset all member progress so everyone
starts equal under the new economy.

## What survives (and why)

The dual-ledger **engine** stays untouched — `ProgressionEvent` (xp +
standing + mastery + reversal machinery) and `Profile.xp`/`standing`
cached balances. It's append-only, idempotent, peer-gated, anti-abuse
capped, and auditable. Rewriting correct infrastructure is waste; the
rewrite is of the **economy, theme, and presentation on top**.

## The V3 model — two currencies, one journey

**Growth (XP)** — your cultivation journey. Grow lifecycle tiers stay
(Seed → Germinated → Seedling → Rooted → Vegged → Trained → Preflower →
Flowering → Ripening → Harvested → Cured → Cultivator → Master
Cultivator) — it's the right theme and already planted everywhere.

**Standing** — community respect, now explicitly **social-first**.
Standing is earned when *people* validate you: reactions to your grows
and moments, accepted answers, contest wins, referrals, quality
follows. V3 makes standing the visible "respect" number — the social
signal that maps to every social platform's follower/karma instinct.

**Masteries** — unchanged as domains (CULTIVATION, RECORDS, KNOWLEDGE,
EXPERIMENTATION, COMMUNITY), but COMMUNITY is re-labeled publicly as
the social track — "Presence" — while keeping the code value stable.

## Earn-rule rebalance (social-first weighting)

New V3 earn rules added to XP_TABLE:

| Event | XP | Standing | Mastery | Notes |
|---|---|---|---|---|
| MOMENT_POSTED | 4 | — | COMMUNITY | Posting to the social stream |
| MOMENT_REACTION_RECEIVED | — | 1 | COMMUNITY | Peer-gated, capped per grantor |
| UPDATE_REACTION_RECEIVED | — | 1 | COMMUNITY | Already-earned content, now pays standing |
| FOLLOWER_GAINED | — | 2 | COMMUNITY | Peer-gated — the social-network signal |
| COMMENT_RECEIVED | — | 1 | COMMUNITY | Engagement on your content |
| REPOST_RECEIVED | — | 2 | COMMUNITY | Amplification — highest social weight |

Rebalanced existing rules: reactions/follows dominate standing earn;
cultivation events stay the XP backbone. All peer-gated, grantor-capped
(existing `STANDING_*` caps apply — anti-abuse is preserved).

## Data reset (Phase 5)

Backup first (`backups/progression-pre-v3-YYYYMMDD/`):
- `ProgressionEvent` — wipe
- `ReputationEvent` — wipe (legacy, audit-only anyway)
- `MasteryProgress` — wipe
- `Profile` — zero `xp`, `standing`, `reputation`
- `Achievement` grants — wipe (re-earnable under V3)
- Badges, streaks, rank history — wipe progress-derived rows

All balances re-derive from zero under V3 rules going forward.

## Presentation (Phase 4)

- Rep page → "Growth & Standing" — dual meters, mastery radar, earn guide
- TierChip/nameplates → show standing tier alongside growth rank
- Leaderboards → growth + standing boards
- "Presence" label on the community mastery everywhere it renders

## Non-goals

- No ledger schema changes (engine preserved)
- No removal of anti-abuse caps
- No retroactive back-awards — V3 starts clean, that's the point
