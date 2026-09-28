# Post-P3/P4/P5 Integrity Reconciliation & Final Baseline

Companion to `full-codebase-integrity-audit.md`. This document records the
implementation pass that reconciled every audit finding, what the final
source-of-truth model is, and the explicit release classification.

## Audited commits

| Ref | Commit | Contains P3 `be0190f` | Contains P4 `038a557` | Contains P5 `06b25e7` |
|---|---|---|---|---|
| `progression-v2` (audit HEAD) | `06b25e7` | yes | yes | yes (HEAD) |
| `origin/progression-v2` | `06b25e7` | yes | yes | yes |
| `master` / `origin/master` | `0f28b6d` | no | no | no (3 commits behind; P0–P2 only) |

Merge-base `master` ↔ `progression-v2` = `0f28b6d`. The reconciled tree IS
the intended post-P3/P4/P5 baseline. No history rewrite, no force-push.

## M-01 — Unlock registry vs live perks (CLOSED)

Root cause: `progressionPerksFrom` shipped five graduated capabilities
(images-per-post 6/8/10, rate-limit ×1.5/×2, thread tags) whose registry
rows were marked `status:"future"`, and three standing-gated privileges
(poll voting, poll creation, slowmode exemption) had no registry rows at
all — the catalog could not represent the shipped truth.

Resolution — promote shipped reality, never remove it:

- `images-6` (Flowering), `images-8` (Harvested), `images-10` (Cultivator),
  `rate-1.5` (Harvested), `rate-2` (Cured) → live rows; each carries a
  comment naming its perk-engine enforcement and route consumer.
- New live rows `poll-vote` (Known/25), `poll-create` (Trusted/100),
  `slowmode-exempt` (Pillar/800) — standing-only specs; `nextRankUnlock`
  correctly never offers them as XP-ladder goals.
- `UnlockSpec.status` doc block now defines the two enforcement models:
  discrete unlocks → `hasUnlock`; graduated/hot-path perks →
  `progressionPerksFrom` (registry row = catalog, perk field = check).
- All genuinely-future rows verified unchanged (`status:"future"`,
  no live enforcement).

Tests: `reputation-tests.mts` — standing-only `hasUnlock` boundaries for
all three new rows + frozen denial; `ui-contracts-tests.mts` "every live
entry is enforced" invariant passes via perk-engine provenance comments.

## M-02 / M-06 — Badge vs Achievement architecture (CLOSED)

Deeper trace corrected the audit's framing: `/api/achievements` and
`/achievements` read `userBadge` + `BADGE_REGISTRY`, not `userAchievement`.
The de-facto live system was already single — the ambiguity was only in
the dormant V2 tables' purpose.

Final architecture (documented in `api/achievements/route.ts` and
`schema.prisma`):

- **LIVE / canonical:** `Badge` + `UserBadge` + `BADGE_REGISTRY` +
  `checkBadges` — every display surface, every grant, every pin.
- **DORMANT framework:** `Achievement` + `UserAchievement` — the
  progression-linked achievement system. No live grant path writes it;
  its only consumer is `hasUnlock`'s achievement route, which serves
  exclusively `status:"future"` rows (`mentoring-tools` → `greenlight`,
  `data-quality-insights` → `full-spectrum`). The migration script's
  LEGACY-family backfill is an archive seed, not a live writer.
- **Contract:** cosmetic badges never gate unlocks; achievement-gated
  unlocks stay `future` until a V2 grant path ships with them. This is
  enforced structurally — `hasUnlock` returns `false` for future rows
  regardless of held achievements.

Plumbing: `hasUnlock` now delegates spec evaluation to the exported
`meetsUnlockSpec(userId, spec)` — lets tests exercise the
achievement/streak/rank/mastery/standing paths against any spec while
`hasUnlock` remains the only gate production routes call.

Tests: synthetic-spec evaluation against the `mentoring-tools` future row
proves (a) V2 grants satisfy the achievement route via `meetsUnlockSpec`,
(b) `hasUnlock` still refuses the row while `status:"future"`.

## M-03 — Unlock-gating bypasses (CLOSED)

- `canSeeDeal` now requires `viewer.unlockFrozen === false` for any
  `minRank`-gated deal; fully-public deals stay open to frozen members
  (kill-switch semantics, matching `hasUnlock`). Both viewers
  (`/deals` page, `/go/[slug]`) populate the flag in one profile read.
- **Correction to the audit:** `spotlight.ts` already filters
  `unlockFrozen: false` in its candidate query — its eligibility
  (`xp ≥ Cured OR non-reversed streak:100 marker`, both denied when
  frozen) is semantically identical to `hasUnlock("grower-spotlight")`.
  No bypass existed; no change needed.
- Canonical model: `hasUnlock` is the discrete-unlock choke point;
  `canSeeDeal` is the deal predicate that must mirror its semantics —
  the frozen test pins the contract.

Tests: `canSeeDeal` frozen-user × gated/public matrix in
`reputation-tests.mts`.

## Phase 4 — V1 reputation writer trace (CLOSED)

- `terpbot-events.ts` never touches `ReputationEvent` — the audit's
  tentative writer lead was false (the file documents "no reputation
  side-effects").
- The ONLY V1 ledger mutations are `reverseReputationEvent /
  reverseReputationByKey / reverseReputationBySource`, reachable from the
  staff reversal route (`/api/moderation/reputation`) and the durable
  pending-reversal drains. `awardReputation`/`applyReputationAward` have
  zero callers in `src/`.
- New static invariant in `verify-security.cjs`: no file under
  `src/app/api/**` may import `awardReputation|applyReputationAward`.
- Freeze contract: **V1 ledger is read-only history + staff reversal —
  no member action and no bot action can mutate it.**

## M-04 — Account export completeness (CLOSED)

Extended `api/profile/export` to cover every user-owned model family that
was missing: `UserAchievement` (+ catalog), `MasteryProgress`,
`StrainPhoto`, `Poll`/`PollVote` (with option text + question), `Feedback`
(staff fields `priority`/`adminNotes`/`resolvedById` stripped),
`DiaryImage`, `PostImage`, `SetupImage`, `GrowExperiment`, `BotEvent`
(idempotency key stripped).

Intentionally excluded (documented in the route): `blocksReceived`,
`SecurityEvent`, `AbuseFlag`, `ModerationAction`, `AffiliateClick`,
`BotSession`, `PendingReversal`/`PendingXpReversal`, reports filed *about*
the user — all either other users' data, security internals, or
ephemeral/derived state.

Tests: `account-verify.mjs` — HTTP export section seeds one row per new
family, asserts presence, redaction, owner-scope (private-diary image),
and anonymous 401.

## M-05 — Persistent browser QA (CLOSED)

New `scripts/browser-tests.mts` — headless Chromium via `playwright-core`
(now a pinned devDependency, `1.63.0`), registered as suite `browser` in
`master-tests.mts` HTTP tier (dev server required, `MASTER_BASE_URL`
overridable). Covers: anonymous home/signin + a11y labels, credentials
login flow, session nav, public/private diary existence oracle (both
directions), profile V2 rendering, `/progress` surface, blocked-profile
privacy boundary, and 390px mobile overflow/nav contracts. Scope is
deliberately narrow — DOM contracts only; transport-level Pusher delivery
remains covered by `runtime-verify`.

## Low findings

| ID | Disposition |
|---|---|
| L-01 room-access predicates | **Fixed** — single `roomAccessDecision` in `chat-access.ts`; `canAccessRoom`, `roomAccessInfo`, `chat/rooms` route and `chat-activity.visibleRooms` all evaluate through it. |
| L-02 dead exports | **Fixed** — removed `unlockStates`, `getTrustScore`, `repRateLimit`, `getTierPerks`. `checkBadgesOccasionally` verified LIVE (chat badge path via `recordChatMessage`) — audit overstated. `runPostAwardEffects`/`postDemotionEffects` retained: live reversal path + `rep3-backfill.mts`. |
| L-03 banned-author counts | **Fixed** — `api/forum/updates` now filters `author: activeAuthor()` in count + latest. |
| L-04 dormant detectors | **Retained intentionally** — `REP_RECIPROCAL_PAIR`/`REP_NEW_ACCOUNT_LIKES` read the frozen V1 ledger; they can still fire on residual historical patterns and feed staff triage via the live cron. Documented in `trust-signals.ts`. |
| L-05 `repRateLimit` alias | **Fixed** — export removed; `verify-security.cjs` pattern comment updated (alias tolerated only in the regex, now moot). |
| L-06 StrainPhoto comment | **Fixed** — schema comment now describes blob-storage URL via `storeImage`. |
| L-07 Reaction NULL uniqueness | **Not a defect** — `@@unique([userId, diaryId])` exists (`Reaction_userId_diaryId_key`); route XOR-enforces exactly one target and handles P2002 gracefully. Audit overstated. |
| L-08 naming debt | **Fixed** — `tierPerks` → `progressionPerks` in threads route; `/api/achievements` naming clarified (product surface intentionally named "Achievements" over the V1 store). |

## Progression source-of-truth model

| Domain | Canonical source | Enforcement | Notes |
|---|---|---|---|
| XP/rank thresholds | `REP_RANKS`, `XP_TABLE` | `awardProgression` (ledger) | drift-checked |
| Standing | `Profile.standing` + `ProgressionEvent` | standing constants | drift-checked |
| Discrete unlocks | `UNLOCKS`/`UNLOCK_BY_ID` | `hasUnlock` → `meetsUnlockSpec` | `status:"future"` hard-refused |
| Graduated perks | same registry + constants | `progressionPerksFrom` | provenance comments map each field to its row id |
| Deals visibility | product `minRank`/`publicAt` | `canSeeDeal` (frozen-aware) | mirrors hasUnlock semantics |
| Spotlight | same spec | `spotlight.ts` query (frozen-aware) | equivalent to hasUnlock |
| Badges (live) | `Badge`/`UserBadge`/`BADGE_REGISTRY` | `checkBadges` | cosmetic; never gates |
| Achievements (dormant) | `Achievement`/`UserAchievement` | `meetsUnlockSpec` achievement route | future rows only |
| V1 ledger | `ReputationEvent` | reversals only | no award path in src |
| Chat rooms | `RoomGate` + flag | `roomAccessDecision` (single predicate) | |

## Export scope

Full matrix in the export route's doc comment: all user-owned/authored
content, social edges, progression ledgers, badge + achievement grants,
poll votes, feedback (redacted), TerpBot command telemetry (key-stripped),
images across post/diary/setup/strain. Exclusions: security internals,
other users' moderation choices, ephemeral/derived state, internal ops.

## Browser QA status

Persistent, registered (`browser` suite, `full` tier). Deterministic
fixtures, full cleanup, no secrets, no production targets.

## Remaining technical debt (accepted, non-blocking)

- `Achievement`/`UserAchievement` remains dormant until an achievement-
  gated unlock ships — by design, not debt.
- One-time migration scripts (`rep3-backfill`, `progression-v2-migrate`)
  retained until the production V2 migration completes.
- `Poll.multiple` vs `@@unique([pollId,userId])` — polls are single-vote
  in practice; multi-select would need a schema change (future roadmap).

## Release status

`RELEASE READY WITH DOCUMENTED NON-BLOCKING DEBT`
