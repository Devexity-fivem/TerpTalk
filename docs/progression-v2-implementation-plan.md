# TerpTalk Progression V2 — Implementation Plan

Companion to `docs/progression-v2-design.md` (**DESIGN LOCKED — rev 3**).
This plan is executable as written: every phase names the files, models,
gates, and tests involved. No redesign decisions are left open — anything
marked *(design §N)* refers to the locked document.

---

## Phase 0 — Preconditions / Safety

- **Branch**: all work on `progression-v2` (or `progression-v2-*`
  feature branches). `master` remains deployable at all times.
- **Clean tree**: implementation starts from a clean working tree; the
  only pending file should be this plan + the design doc.
- **Production DB protection**:
  - `DATABASE_URL` must point at a Neon **development branch** for all
    migration development — never the production branch. The existing
    `scripts/db-guard.mjs` pattern is extended: a `MIGRATION_ENV=dev`
    assertion before any destructive/dev migration script runs.
  - No production migration runs until Phase 16's sequence; all schema
    iteration happens on the dev branch with `prisma migrate dev`.
- **Backup expectations**:
  - Before production migration: Neon snapshot + `pg_dump` of
    `Profile`, `ReputationEvent`, `PendingReversal`, `Badge`,
    `UserBadge`, `User`, `AbuseFlag` tables archived off-cluster.
  - The dump is validated (row counts + checksum spot-check) before
    cutover begins.
- **Feature-flag strategy**:
  - `progression_v2` Setting key — master switch (read path + award path).
  - `xp_dual_write` — during engine bring-up, new `ProgressionEvent`
    rows are written *alongside* legacy `ReputationEvent` rows so both
    ledgers can be diffed before cutover.
  - `standing_v2` — standing-axis enforcement (gates) independent of XP.
  - Per-unlock flags default OFF until the feature exists; the unlock
    registry (Phase 6) reads them.
- **Rollback**: flag-off restores legacy behavior only during the
  dual-write period (Phase 3–5 dev); after cutover, rollback =
  forward-fix (Phase 17 details what is and isn't reversible).
- **Hard rule**: no Vercel deploy of `progression-v2` branches to the
  production project; previews only.

---

## Phase 1 — Schema / Data Model

New migration `YYYYMMDD_progression_v2` (dev branch only until Phase 16).

### 1.1 `ProgressionEvent` — the new ledger

| Field | Type | Notes |
|---|---|---|
| id | String @id @default(cuid()) | |
| userId | String → User | award subject |
| mastery | String? | CULTIVATION/RECORDS/KNOWLEDGE/EXPERIMENTATION/COMMUNITY; NULL = SYSTEM |
| type | String | award taxonomy (Phase 3.1) + REVERSAL/REINSTATE/STAFF_ADJUSTMENT/LEGACY_STANDING/MILESTONE/STANDING_RECOVERY/UNLOCK_FREEZE |
| xp | Int @default(0) | progression currency |
| standing | Int @default(0) | trust currency |
| reason | String | human-readable |
| key | String? @unique | idempotency — same semantics as today |
| sourceType/sourceId | String? | bulk reversal targeting |
| actorId | String? | provenance (who triggered) |
| meta | Json? | `{ band, dup, simhash, questSlug, standingSource, grantorAgeDays, ... }` |
| reversedAt | DateTime? | |
| reversalOfId | String? → self | |
| reversalFinal | Boolean @default(false) | staff-finalized, immune to reinstate |
| createdAt | DateTime @default(now()) | |

Indexes: `(userId, createdAt)`, `(userId, mastery, createdAt)`
(soft-cap counting), `(sourceType, sourceId)`, `(actorId)`, `(key)`,
`(type, createdAt)` (weekly board / telemetry).

### 1.2 `MasteryProgress` — cached per-path balance

`userId` + `mastery` (PK pair) + `xp Int`. Upserted inside the award
transaction. Drift invariant: `MasteryProgress.xp == SUM(xp)` grouped
by `(userId, mastery)` over ProgressionEvent.

### 1.3 `Achievement` / `UserAchievement`

- `Achievement`: id, `key @unique`, `family`, `name`, `description`,
  `icon`, `rarity` (COMMON/RARE/EPIC/LEGENDARY/HIDDEN/LEGACY),
  `spec Json?` (declarative predicate for stat-derived achievements),
  `unlocks String?` (unlock-registry key it grants, §8.5), `hidden Boolean`.
  Definitions seeded from a config registry — same pattern as the
  current badge registry.
- `UserAchievement`: userId + achievementId (`@@unique`), earnedAt,
  pinned Boolean. Mirrors UserBadge semantics.

### 1.4 `PendingXpReversal` — outbox

Field-for-field port of `PendingReversal` (kind SOURCE/KEY/ACTOR, reason,
requestedBy snapshot, status, attempts, error, claim/heartbeat). Kept as
a separate table so the legacy outbox can drain cleanly and freeze.

### 1.5 `Profile` additions

| Field | Type | Purpose |
|---|---|---|
| xp | Int @default(0) | cached XP balance (drift-checked) |
| standing | Int @default(0) | cached standing balance (drift-checked) |
| legacyVerified | Boolean @default(false) | grandfathered VERIFIED_MEMBER marker |
| unlockFrozen | Boolean @default(false) | staff kill-switch for unlocks |
| reputation | Int | **retained, frozen** at cutover — audit only |

No schema change to `ReputationEvent`, `Badge`, `UserBadge`,
`PendingReversal` — they freeze as-is.

### 1.6 Why this shape

Reuses the proven ledger/outbox/cached-balance architecture verbatim
(proven at scale in production); the only structural additions are the
dual currency columns, the mastery tag, and meta JSON for audit of
band/duplicate decisions. No existing model is overloaded to mean
something it didn't.

---

## Phase 2 — Legacy Reputation Migration

Run as one transaction-per-user batched script
(`scripts/progression-v2-migrate.mts`, new — migration script, not a
test suite):

| Data | Disposition |
|---|---|
| `Profile.reputation` | **Frozen** — kept on the profile for audit display, no longer updated |
| `ReputationEvent` | **Frozen/retained** — read-only audit ledger; writes stop at flag flip |
| `PendingReversal` | **Drained then frozen** — run the outbox to empty before cutover; pending items that can't complete are marked DEAD with reason `cutover` |
| Old tiers | **Retired** — config constants deleted at cleanup phase; no DB state |
| `Badge`/`UserBadge` | **Archived** — rows kept; registry gains `LEGACY` rarity; UI collapses them into a "Legacy collection" |
| `Profile.avatarFrame/profileTitle/profileTheme` | **Revalidated** — cosmetics not qualified under new rank mapping are unequipped; a `LEGACY_VANITY` achievement grants a keepsake version to prior owners |
| Old quests/challenges/journeys | **Replaced** — new definitions (same engine); pending keyed payouts from the old epoch are not paid |
| Streaks | **Retained** — engine survives; milestone rewards switch from XP to utility (Phase 10) |
| Standing | **Seeded** — `LEGACY_STANDING` ProgressionEvent per user: `standing = clamp(SUM(trust-type ReputationEvent.amount), 0, N)`; keyed `standing:legacy:{userId}` so it's idempotent |
| Verification | `VERIFIED_MEMBER` holders → `legacyVerified = true`; role retained; Progression Verified path begins fresh (design §9.6) |

**Reconciliation requirements** (run post-migration, before flag flip):
- `Profile.xp == 0` for all users; `Profile.standing == LEGACY_STANDING row`.
- `xp == SUM(xp)`, `standing == SUM(standing)` invariants hold.
- Frozen `reputation` unchanged; `ReputationEvent` row count stable
  (freeze marker event logged).
- Spot-check: 50 sampled users — legacy badge count = archived count,
  standing seed = computed trust-sum.

---

## Phase 3 — XP / Mastery Engine

### 3.1 Event taxonomy (config: `XP_TABLE` in `progression-config.ts`)

Cultivation: `DIARY_CREATED`(15), `UPDATE_DAY`(5), `UPDATE_RICH`(+3),
`UPDATE_EXCEPTIONAL`(+6), `STAGE_ESTABLISHED`(15), `STAGE_VEGGING`(25),
`STAGE_FLOWERING`(40), `HARVEST_LOGGED`(50), `GROW_COMPLETE`(50),
`SEASON_FINISHER`(25).
Records: `STRUCTURED_CATEGORY`(+2, cap +6), `METRIC_FIRST`(+5 once
each ×~12), `SETUP_SHOWCASE`(10), `STRAIN_PHOTO`(4),
`COVERAGE_MILESTONE`(+25), `HARVEST_REPORT`(+30).
Knowledge: `SUBSTANTIVE_ANSWER`(+4), `ACCEPTED_ANSWER`(+30 XP/+10 st),
`OP_CURATION`(+5), `NEWCOMER_ACCEPT`(+10 st +12), `GUIDE_PUBLISHED`
(+50 XP/+10 st), `GUIDE_IMPROVEMENT`(+15), `STRAIN_SOURCED`(10),
`PROBLEM_RESOLVED`(+20).
Experimentation: `EXPERIMENT_CREATED`(+5), `HYPOTHESIS_DOC`(+5),
`EXPERIMENT_COMPLETED`(+25), `FAILURE_DOCUMENTED`(+8, §6.4a gates),
`FOLLOWUPS_3`(+10), `REPLICATION`(+20).
Community: `THREAD_STARTED`(+8), `REPLY`(+2), `NEWCOMER_REPLY`(+3),
`CONTEST_ENTRY`(+5), `CONTEST_WIN`(+50/+150 XP, +10/+20 st),
`REFERRAL`(+25 XP/+15 st), `MENTOR_SESSION`(+5).
System: `QUEST_DAILY`, `CHALLENGE_WEEKLY`, `ARC_STEP`, `LEGACY_STANDING`,
`STANDING_RECOVERY`, `STAFF_ADJUSTMENT`, `UNLOCK_FREEZE`, `MILESTONE`,
`REVERSAL`, `REINSTATE`.

### 3.2 Award path — `awardProgression(userId, mastery, type, {xp,
standing}, reason, opts)`

Port of `applyReputationAward`/`awardReputation` (reputation.ts L320–
1297): inside one serializable tx — keyed insert, `Profile.xp +=
xp`, `Profile.standing += standing` (clamped ≥0), `MasteryProgress`
upsert. Quality/band/simhash/soft-cap evaluated **inside** the award
call before the write.

### 3.3 Quality bands — `evaluateUpdateBand(update)`

Deterministic rules from design §6.7: band 0 void / 1 base / 2 rich /
3 exceptional; result written to `meta.band`. Same helper drives post
quality (≥200-char substantive test).

### 3.4 Duplicate detection — `checkDuplicate(authorId, prose)`

Simhash on prose only vs author's 30-day content; returns
`clean | reduced | withheld` per the three-tier table; `meta.dup` +
matched sourceId recorded. Structured-data-change check exempts honest
recurring logs.

### 3.5 Soft caps — `applyMasterySoftCap(userId, mastery, xp)`

Counts week-to-date self-driven XP in that mastery (indexed
`(userId, mastery, createdAt)` query); applies 100%/50%/25% bands at
250/500. Peer-gated types exempt (accepts, contests, referrals — tagged
`peerGated` in the taxonomy).

### 3.6 Callsite map — every existing `awardReputation` call

| File | Line(s) | New behavior |
|---|---|---|
| `api/forum/threads/route.ts` | 273, 433, 438 | THREAD_CREATED → `THREAD_STARTED`(Community +8); deletion → source reversal enqueue (same) |
| `api/forum/posts/route.ts` | 151, 425 | POST_CREATED → `REPLY`(Community +2, +4 Knowledge if ≥200 chars, +3 newcomer bonus) |
| `api/diaries/route.ts` | 213, 312 | DIARY_CREATED → `DIARY_CREATED`(Cultivation 15) |
| `api/diaries/updates/route.ts` | 263, 384 | DIARY_UPDATE → `UPDATE_DAY` + band + `STRUCTURED_CATEGORY` per category |
| `api/diaries/[id]/harvest/route.ts` | 171 | HARVEST_LOGGED → `HARVEST_LOGGED` + `GROW_COMPLETE` + `HARVEST_REPORT` + `SEASON_FINISHER` evals |
| `api/strains/route.ts` | 201 | STRAIN_CREATED → `STRAIN_SOURCED`(Knowledge 10) |
| `api/strains/photos/route.ts` | 89, 144 | STRAIN_PHOTO → `STRAIN_PHOTO`(Records 4) |
| `api/setups/route.ts` | 160, 216 | SETUP_CREATED → `SETUP_SHOWCASE`(Records 10) |
| `api/reactions/route.ts` | 134, 157, 173 | **OBSOLETE** — likes/reactions write no events |
| `api/forum/threads/accept/route.ts` | 86, 92, 130, 150, 168 | HELPFUL_ANSWER → `ACCEPTED_ANSWER`(Knowledge +30/+10 st, grantor floor, newcomer bonus); ACCEPT_MARKED → `OP_CURATION` |
| `api/profile/complete/route.ts` | 170 | ONBOARDING_COMPLETE → keep (System/Cultivation 15) |
| `api/onboarding/complete/route.ts` | 34 | same |
| `api/ping/route.ts` | 53 | DAILY_LOGIN → **0 XP**; streak eval stays (utility rewards); quest/challenge eval calls stay |
| `api/chat/commands/route.ts` | 183 | streak/quest eval passthrough — retarget to new engine reads |
| `lib/quests.ts` | 281, 293, 403, 417 | QUEST_DAILY → `QUEST_DAILY` keyed per mastery tag |
| `lib/challenges.ts` | 240, 307 | CHALLENGE_WEEKLY → same |
| `lib/journeys.ts` | 167 | JOURNEY_COMPLETE → `ARC_STEP` |
| `lib/grow-journey.ts` | 295 | GROW_MILESTONE → `STAGE_*` types (Cultivation) |
| `lib/streaks.ts` | 63 | STREAK_BONUS → **no XP**; emits non-XP reward markers |
| `lib/contest-awards.ts` | 25, 27, 55 | contest wins → `CONTEST_WIN` dual xp+standing; entry → `CONTEST_ENTRY` |
| `lib/weekly-recognition.ts` | 156 | board → member-driven XP (not likes); award → `WEEKLY_AWARD` |
| `lib/terpbot-events.ts` | 13 | telemetry only — unchanged |
| `api/moderation/actions/route.ts` | 101–277 | CONTENT_DELETION/BULK reversals → new outbox; `MOVE_THREAD` unchanged |
| `api/moderation/bulk/route.ts` | 126, 131 | bulk reversal → `PendingXpReversal` enqueue |
| `api/moderation/reputation/route.ts` | 137 | STAFF_ADJUSTMENT → dual-currency version (xp/standing fields) |
| `api/admin/reputation/route.ts` | 49 | admin adjust → same port |
| `api/admin/users/route.ts` | 286 | ban sweep → actor reversal enqueue |
| `api/admin/media/route.ts` | 131 | media-delete reversal → same |
| `lib/reputation.ts` | all | engine ported to `progression.ts`; legacy file frozen |
| `lib/reputation-outbox.ts` | all | ported to `progression-outbox.ts` |

**Obsolete callsites**: `api/reactions/route.ts` award calls;
`DAILY_LOGIN` award inside ping; `VERIFIED_MULTIPLIER` application;
`BADGE_BONUS` payout path (achievements pay 0).

---

## Phase 4 — Standing Engine

### 4.1 Standing event types

Positive: `ACCEPTED_ANSWER`(+10), `NEWCOMER_ACCEPT`(+12 total),
`CONTEST_WIN`(+10/+20), `REFERRAL`(+15), `GUIDE_PUBLISHED`(+10),
`REPORT_UPHELD`(+5), `STAFF_GRANT`(bounded ±).
Negative: `REPORT_AGAINST`(−20), `ABUSE_FLAG_RESOLVED`(−50),
`MASS_REVERSAL`(−15), `STAFF_DEDUCTION`.
Recovery: `STANDING_RECOVERY`(+25, once per flag, after 90 flag-free days).
Seed: `LEGACY_STANDING`.

### 4.2 Controls to implement

- **Weekly ceiling** 40 — week-sum over standing>0 member-driven events;
  staff grants exempt (meta `exempt: "staff"`).
- **Per-grantor diminishing**: standing awards grouped by `actorId`;
  first full, subsequent within 90d at 50%, per-grantor lifetime cap 30.
- **Reciprocal discount**: if `actorId` received standing from subject
  within 90d → standing portion pays 0, `meta.reciprocal: true`.
- **Cluster discount**: trailing-90d in-cluster concentration ≥60% →
  in-cluster awards pay 0 + `AbuseFlag`.
- **Per-source-type caps**: contest/referral/report ≤20 standing/ISO week each.
- **Grantor floor**: sub-Trusted grantor halves the award (min 0).
- All rules evaluated inside `awardProgression` before the write —
  standing never bypasses the engine.

### 4.3 Standing callsites

Same accept/contest/referral/guide/report/staff callsites as Phase 3.6
(they're dual-currency events); plus `standing recovery eval` (cron,
Phase 14) and the `verified` promotion check (Phase 7).

### 4.4 Audit requirements

Every standing event carries `meta.standingSource` + `actorId`; the
ledger is the audit trail; standing deductions write the reason. No
standing mutation outside the engine (enforced by making the helper the
only writer).

---

## Phase 5 — Rank / Progression Engine

- **Thresholds**: locked §5.1 table in `progression-config.ts` —
  `REP_RANKS = [0, 60, 180, 420, 900, 1600, 2600, 4000, 5800, 7500,
  12000, 17000, 23000]`.
- **`rankFromXp(xp)`** + **`masteryLevelFromXp(pathXp)`** (thresholds
  `50/150/350/750/1500/3000/6000/10000/16000/24000`).
- **Sub-levels**: ~36 named checkpoints across gaps — config table;
  once-ever `MILESTONE` marker rows (0-amount) drive celebrations.
- **Diversity floors**: `rankGate(userId)` returns
  `{ xpMet, floorsMet, missingPaths[] }`; rank-up fires when both hold —
  banked XP promotes automatically (checked inside award + on mastery
  level-up, keyed markers prevent re-fire).
- **Downgrades**: rank reflects *current* XP balance — a reversal that
  drops XP below threshold lowers displayed rank on next read;
  unlocks once granted persist (unless `unlockFrozen`); standing-gated
  access re-checks live.
- **Progress calc**: `rankProgress(xp)` → `{ rank, subLevel, nextAt,
  pct }`; `buildTitle(masteryMix)` per §7.2 table.

---

## Phase 6 — Unlock Engine

Registry in `progression-config.ts`: `UNLOCKS[id] = { name, category,
layer, rank?, mastery?: {path, level}, standing?, achievement?,
flag?, feature }`. Single enforcement helper:
`hasUnlock(userId, unlockId)` → evaluates rank + mastery + standing +
achievement + `unlockFrozen` + feature flag. All gated features call it
server-side.

### Unlock map (design §8)

| ID | Name | Cat | Layer | Rank | Mastery | Standing | Achv | ★/◆ | Enforcement point | UI |
|---|---|---|---|---|---|---|---|---|---|---|
| streak-dashboard | Streak dashboard + grow summaries | A | A | Germinated | — | — | — | ★ | `/api/progression`, diary summary endpoint | /progress card |
| saved-searches-3 | Saved searches → 3 | Cp | A | Germinated | — | — | — | ★ | saved-search POST limit | search UI |
| comparison-basic | Basic grow comparison | A | A | Seedling | — | — | — | ★ | comparison API route | diary analytics tab |
| comparison-slot-2 | +1 comparison slot | Cp | A | Seedling | — | — | — | ◆ | comparison save API | comparison UI |
| grow-templates | Grow templates | F | A | Rooted | — | — | — | ◆ | template API + update form | update composer |
| quest-slot-4 | 4th daily quest | F | A | Rooted | — | — | — | ★ | quest selection engine | /progress |
| saved-views | Saved views | Cv | A | Rooted | — | — | — | ◆ | saved-view API | diary/feed filter bar |
| env-analytics | Environmental analytics 30/90d | A | B | Vegged | Records M2 | — | — | ◆ | analytics API | diary analytics tab |
| comparison-env | Advanced env comparison | A | B | Vegged | Records M2 | — | — | ◆ | comparison API | comparison UI |
| harvest-analytics | Harvest analytics | A | A | Vegged | — | — | — | ◆ | analytics API | diary analytics tab |
| grows-6 | Active grows → 6, searches → 6 | Cp | A | Vegged | — | — | — | ◆ | diary-create API, search API | diaries page |
| export-tools | JSON/CSV export | F | A | Trained | — | — | — | ◆ | export API | diary/profile menu |
| advanced-filters | Strain/equipment facets | F | A | Trained | — | — | — | ◆ | explore API | explore page |
| saved-searches-10 | Searches → 10 | Cp | A | Trained | — | — | — | ◆ | saved-search API | search UI |
| custom-reminders | Deterministic reminders | F | A | Trained | — | — | — | ◆ | reminders API + cron | diary page |
| terpbot-watch-basic | 3 single-metric watch rules | T | A | Preflower | — | — | — | ◆ | watch-rule API + bot eval | TerpBot panel |
| longitudinal-analysis | Episodes/baselines/timeline | T | B | Flowering | Records M2 | — | — | ★ | intel API | diary intelligence tab |
| comparison-multi | Multi-grow comparison | A | B | Flowering | Records M2 | — | — | ◆ | comparison API | comparison UI |
| images-6 | Images/post → 6 | Cp | A | Flowering | — | — | — | ★ | post/upload API | composer |
| guide-authoring | Guide authoring | L | B | Ripening **or** Knowledge M3 | alt | — | — | ◆ | guide publish API | guides section |
| challenge-creation | Member-run challenges | L | B | Ripening **or** Community M4 | alt | — | — | ◆ | challenge API | challenges page |
| mentoring-tools | Mentor queue + flair | L | C | Knowledge M3 **or** Ripening | — | Trusted | Greenlight(alt) | ◆ | mentor API | mentor queue |
| nutrient-schedules | Feed-chart presets | F | B | — | Records M3 | — | — | ◆ | nutrient API | update composer |
| data-quality-insights | Coverage score + hints | A | B | — | Records M2 | — | Full Spectrum(alt) | ◆ | coverage API | diary page |
| experiment-templates | Clone experiment structure | F | B | — | Experimentation M2 | — | — | ◆ | experiment API | experiment form |
| rate-1.5 | Rate limits ×1.5 | Cp | A | Harvested | — | — | — | ★ | rate-limiter | — |
| images-8 | Images → 8 | Cp | A | Harvested | — | — | — | ★ | upload API | composer |
| grower-cockpit | Grower Cockpit | F | A | Harvested | — | — | — | ◆ | cockpit API | flagship page |
| watch-advanced | 10 rules + multi-day conditions | T | B | Harvested | Records M3 | — | — | ◆ | watch-rule API | TerpBot panel |
| watch-compound | Multi-condition rules | T | B | — | Records M4 | — | — | ◆ | watch-rule API | TerpBot panel |
| experiment-analysis | Aggregate experiment insights | T | B | Harvested | Experimentation M2 | — | — | ◆ | intel API | experiments tab |
| historical-trends | Grow vs own history | A | B | Cured | Records M4 | — | — | ◆ | analytics API | analytics tab |
| dashboard-advanced | Advanced widgets + watch→15 | A/T | A | Cured | — | — | — | ◆ | dashboard API | cockpit |
| rate-2 | Rate ×2, tags → 7 | Cp | A | Cured | — | — | — | ★ | rate-limiter, thread API | — |
| grow-room | Grow Room access | L | C | Cultivator | — | Trusted | — | ★ | `chat-access.ts` + rooms API | chat |
| community-evidence | Anonymized aggregate views | A | C | Cultivator | — | Trusted | — | ◆ | evidence API | evidence page |
| quest-slot-5 | 5th quest slot, images→10 | Cp | A | Cultivator | — | — | — | ★ | quest engine, upload API | /progress |
| the-vault | The Vault access | L | C | Master Cultivator | — | Respected | — | ★ | `chat-access.ts` + rooms API | chat |
| research-aggregates | Deeper anonymized stats | A | B | Master Cultivator | Records M4 | — | — | ◆ | research API | research page |
| early-access | Feature-flag channel | P | A | Master Cultivator | — | — | — | ◆ | flag resolver | settings |
| apex-cosmetics | Northern Lights frame etc. | Cs | A | rank track | — | — | — | ★ | cosmetics equip API | profile editor |

Achievement-granted unlocks (design §11.2) are entries with `achievement`
as the sole prerequisite — evaluated by the same `hasUnlock`.

**Enforcement rule**: any capability touching data or permissions is
checked server-side in the route handler; UI gating is presentational
only. `hasUnlock` is the single choke point — no route hand-rolls
threshold checks.

---

## Phase 7 — Existing Feature Gates (rewire)

| Feature | Current gate | New gate | Enforcement point | Tests |
|---|---|---|---|---|
| Grow comparison | none (open) | `comparison-basic` (Seedling) | comparison route | rewards3/forum-verify |
| External links | rep ≥150 + 24h | standing ≥ Known + 24h | post/thread validators | trust-safety |
| Poll vote/create | rep ≥500 | standing ≥ Known/Trusted | poll routes | trust-safety |
| Verified promotion | rep ≥1500+30d → role + ×1.5 | standing ≥ Respected + 30d + no flags → role (no multiplier) | promotion eval in award path | trust-safety |
| Grow Room | rep ≥3500 | Cultivator + Trusted | `chat-access.ts`, rooms/pusher routes | runtime-verify |
| The Vault | rep ≥15000 | Master Cultivator + Respected | same | runtime-verify |
| Rate boosts ×1.5/×2 | tier thresholds | Harvested/Cured | `security.ts` limiter | runtime-verify |
| Images 6/8/10 | tier thresholds | Flowering/Harvested/Cultivator | upload/post validators | forum-verify |
| Tags → 7 | tier | Cured | thread route | forum-verify |
| Quest slots 3→4→5 | tier | Rooted/Cultivator | quest engine | rewards3 |
| Slowmode exempt | tier | Pillar standing | chat limiter | trust-safety |
| Showcase slots 3→14 | tier | re-map to rank | profile route | forum-verify |
| Cosmetics equip | rep-derived | rank-derived + legacy keepsakes | `cosmetics.ts` | self-service |
| Longitudinal intel | internal | `longitudinal-analysis` (Flowering+Records M2) | intel API | terpbot suite |
| Weekly board | member-driven rep types | member-driven XP events | `weekly-recognition.ts` | rewards3 |

Every `perksAt`/`REP_TIERS` consumer (`security.ts`, `chat-access.ts`,
`cosmetics.ts`, `journeys.ts`, `rooms`/`messages`/`pusher` routes,
`reputation-roadmap.tsx`, `progress/page.tsx`, `reputation/page.tsx`)
moves to `hasUnlock`/`rankFromXp`/`standing` equivalents.

---

## Phase 8 — NEW ◆ Functional Builds

Separated from ★ gates; each shippable independently behind its flag.

| Feature | Scope | Deps | UI/API/schema | Privacy | Abuse | Perf | Ships independent | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Grow templates | Prefilled update forms per medium/method | — | new template table + composer UI | own data | none | trivial | ✓ | Template applies fields; update posts normally |
| Saved views | Named filter presets | — | table + API + filter bar UI | own data | none | trivial | ✓ | CRUD works; applies filters |
| Env analytics | 30/90d env graphs, VPD split | diary metrics | analytics API + charts | own data | none | indexed update reads | ✓ | Charts render real ranges |
| Advanced env comparison | Env overlay vs medians | comparison engine | API + UI | k-anonymized medians | none | aggregate query | ✓ | Overlay matches data |
| Harvest analytics | Yield/rating trends | harvest fields | API + charts | own | none | simple | ✓ | Real aggregates shown |
| Export tools | Diary+data JSON/CSV | — | export API + download UI | own data only | rate-limited | async-safe | ✓ | Export round-trips |
| Advanced filters | Strain/equipment facets | catalog | explore API + UI | none | none | indexed | ✓ | Facets filter correctly |
| Custom reminders | Deterministic notify rules | notifications | API + cron eval | own | capped count | cron tick | ✓ | Fires on schedule |
| Watch rules (basic) | 3 single-metric threshold alerts | diary metrics + notify | rule table + eval in update path | own | rule count cap | per-update eval | ✓ | Alert fires on breach |
| Watch rules (advanced/compound) | 10 rules, multi-day, multi-condition | basic watch | same table, richer spec | own | cap | bounded eval | needs basic | Compound rule evaluates |
| Multi-grow comparison | Compare N grows | comparison engine | API + UI | own | none | N diary read | ✓ | Two grows overlay |
| Grower Cockpit | Unified grow ops surface | watch+comparison+quests | new page + composite API | own | none | batched queries | needs watch+comparison | All panels render real data |
| Historical trends | Grow vs own history | all grows | API + UI | own | none | multi-diary read | needs multi-grow | Correct self-history |
| Experiment analysis | Aggregate your experiments | experiment rows | intel API | own | none | groupBy | ✓ | Real aggregates |
| Guide authoring | Publish/edit/review guides | content model | guide table + editor + queue | public | review queue, rate limits | — | ✓ | Guide publishes after review |
| Challenge creation | Member-run challenges + join tracking | notifications | challenge tables + UI | public | entry caps, spam rules | — | ✓ | Challenge runs end-to-end |
| Mentoring tools | Unanswered-Q routing + flair | threads | mentor queue API + UI | public | daily assist cap | — | ✓ | Routed questions appear |
| Nutrient schedules | Brand presets + feed charts | catalog | schedule data + composer insert | none | none | static | ✓ | Preset fills nutrient rows |
| Coverage insights | Coverage score + hints | diary metrics | coverage API + UI | own | none | derived query | ✓ | Score matches data |
| Experiment templates | Clone experiment spec | experiments | API + form | own | none | trivial | ✓ | Clone copies fields |
| Community evidence | Anonymized aggregate patterns | all public diaries | API + UI | k-anonymity min-sample | re-identification guard | heavy aggregate — cached | needs analytics | Min-sample enforced |
| Research aggregates | Deeper anonymized stats | same | API | same | same | cached | needs evidence | Min-sample enforced |
| Early access | Flag channel | flags | settings toggle | none | none | trivial | ✓ | Flag respected |
| Grow Summary card | Public grow recap | diary | card component + share | public-safe fields | none | cached | ✓ | Summary renders |
| Experiment Log | Experiment list view | experiments | page | own | none | paged | ✓ | Lists own experiments |
| Harvest Comparison | Compare own harvests | harvest fields | API + UI | own | none | few rows | needs analytics | Overlay correct |
| Mentor queue | Unanswered-question routing | threads | queue API + UI | public | bounded | indexed query | needs mentoring | Routes questions |

**Build order** (cheap→flagship): templates, saved views, reminders,
export, filters → env/harvest analytics, coverage insights → watch
basic→advanced→compound → multi-grow compare, experiment analysis →
grow summary/log, harvest comparison → cockpit (composes the above) →
guide authoring, challenges, mentoring → evidence/research aggregates.

---

## Phase 9 — Achievements / Badges

- **Legacy handling**: `Badge`/`UserBadge` rows retained; registry gains
  `LEGACY` rarity; UI shows a collapsed "Legacy collection" — not
  deleted, not re-earned.
- **New registry** (`achievement-registry.ts`, ~40 items) — families:
  Milestone, Cultivator, Journaler, Harvester, Problem Solver,
  Researcher, Experimenter, Community, Explorer, Mentor, Seasonal,
  Hidden, Rare/Prestige, Legacy. Chains of 3–5 rungs, no raw-volume
  rungs.
- **Utility unlocks**: `Achievement.unlocks` → registry key
  (First Harvest→`grow-summary-card`, Triple Harvest→
  `harvest-comparison`, Lab Notes→`experiment-log`, Replicated→
  experiment-compare, Greenlight→mentoring alt-gate, Full Spectrum→
  coverage alt-gate, Perfect Record→high-evidence marker, Mentor→flair
  +routing).
- **Award callsites**: achievement eval piggybacks the award path +
  ping eval — port of `badges.ts` evaluator, same derived-not-stored
  progress approach.
- **Hidden/rare**: `hidden` rows render as "???" until earned.
- **0 XP** always — achievements never write XP events.
- Migration: users' old `UserBadge` rows map to LEGACY achievements
  (same display, no re-grant of utility).

---

## Phase 10 — Streaks / Quests / Challenges / Journeys

| System | Disposition | Detail |
|---|---|---|
| Check-in streak | **Modified** | survives; milestone rewards → utility only (§10.4: quest slot week, bonus quest, cosmetics, Evergreen); `DAILY_LOGIN` XP removed |
| Grow streak | **Retained** | feeds Cultivation quests + Journaler chain |
| Daily quests | **Rebuilt** | new pool (design §10.1), mastery-tagged payouts, quest-slot unlocks respected, capability-gated entries ("run a comparison" only if unlocked) |
| Weekly challenges | **Rebuilt** | new arcs (~40 XP/wk), same keyed engine |
| Journeys | **Rebuilt** | three arcs (First Grow / Data-Rich Grower / The Helper), `ARC_STEP` payouts |
| Weekly recognition | **Modified** | board = net member-driven XP; award → `WEEKLY_AWARD` |
| Contests | **Retained** | wins pay dual xp+standing via `CONTEST_WIN` |
| Referral | **Retained** | deferred payout → `REFERRAL` dual |

None becomes a competing currency — all of them pay into the single XP
ledger or grant utility.

---

## Phase 11 — TerpBot

- **Commands**: `/rep`→`/rank`, `/progress`→`/progress` (new payload),
  `/masteries` (path levels + build title), `/quests`, `/achievements`,
  `/next` (nearest unlock + gap), `/streak`, `/badge`→achievement info,
  `/grow` unchanged, `/nextbadges`→`/nextachievements`.
- **Intent map** (`terpbot-intents.ts`): rep/tier/next-tier/streak/
  quest/badge patterns → new vocabulary; "what should I do" → next-
  action resolver.
- **Unlock awareness**: TerpBot check `hasUnlock` before offering
  watch/longitudinal/experiment-analysis surfaces; when locked, says
  what rank/mastery opens them (tease, never paywall tone).
- **Watch rules**: rule CRUD gated by `terpbot-watch-basic`/
  `watch-advanced`/`watch-compound`; eval in update path (deterministic
  thresholds, no LLM).
- **Announcements**: rank-up / path-level-up / unlock markers →
  once-ever MILESTONE rows → notification pipeline (existing pattern).
- **Least privilege**: TerpBot identity unchanged — read user
  progression, announce, evaluate watch rules. No moderation, no
  standing writes, no unlock mutation.

---

## Phase 12 — UI / UX

| Surface | Change |
|---|---|
| `/progress` (page.tsx) | Full redesign per §12 design: hero (rank+sub-level+next unlock), next-action, active-grow card w/ coverage, mastery bars + build title + diversity-floor status, quest board, achievement chains, separate standing panel |
| `/reputation` (page.tsx) | → standing/trust explainer + legacy audit view |
| `/achievements` | Families + chains + legacy collection collapse |
| `/leaderboard` | XP + per-path boards + standing board |
| Profile | rank chip + mastery pips + build title + standing chip; cosmetics unchanged mechanics |
| `reputation-roadmap.tsx` | → unlock roadmap ("next unlock — what it is, how to use it") |
| member-home | next-action resolver feeds the existing card |
| Diary page | coverage score tease/badge-gated insight prompts |
| Notification copy | "You reached Rooted II — Grow templates are now available. Try one →" |
| Composer | template picker (Rooted+), nutrient preset insert (Records M3) |
| TerpBot panel | watch-rule editor (gated), progression summary |

Rule: XP and standing never share iconography; every unlock explains
what/why/how — never "Achievement unlocked."

---

## Phase 13 — APIs / Server Enforcement

| Route | Change |
|---|---|
| `GET /api/progression` | v2 payload: xp, rank, subLevel, nextUnlock, masteries, build, standing, quests, streak, nearAchievements, floors status |
| `GET /api/users/[username]/progression` | public-safe view (rank, build, achievement showcase — no standing score unless self) |
| `GET /api/leaderboard` | xp + mastery boards |
| `POST /api/awards/*` (internal) | unified `awardProgression` entry |
| `GET/POST/DELETE /api/watch-rules` | new — gated by watch unlocks |
| `GET /api/export/[diaryId]` | new — `export-tools` gate |
| `GET /api/cockpit` | new — `grower-cockpit` gate |
| `GET /api/analytics/*` | new family — per-unlock gates |
| `POST /api/admin/progression/freeze` | unlock freeze toggle (staff) |
| `POST /api/moderation/adjust` | dual-currency staff adjustment |
| award callsite routes (Phase 3.6) | retargeted to `awardProgression` |

Every gated route checks `hasUnlock` server-side and returns 403 +
`unlockId` on deny so the UI can show the path to unlock.

---

## Phase 14 — Cron / Background Jobs

On the existing `cron/terpbot` tick (Vercel Hobby — single daily route):

- **Quest/challenge reconcile** — ported, new definitions (existing
  pattern, same tick).
- **Referral reconcile** — ported.
- **Standing recovery eval** — new: 90-day-flag-free → `STANDING_
  RECOVERY` +25 once per flag.
- **Weekly recognition resolution** — board on member-driven XP.
- **Watch-rule eval** — piggybacks the update path (per-update), with a
  daily catch-up sweep for missed evals.
- **Custom-reminder eval** — daily check of due reminders.
- **Drift checks** — 3 invariants (xp sum, standing sum, mastery sums);
  failures → `AbuseFlag`-style alert rows + logged.
- **Velocity/reciprocal/cluster detectors** — ported, retargeted at new
  event types + standing patterns.
- **Outbox drain** — `PendingXpReversal` claim/process/fixpoint.
- All jobs idempotent by event keys; retries bounded (10 → DEAD) —
  existing outbox semantics.

---

## Phase 15 — Tests

No new suites — extend canonical ones:

| Suite | New cases |
|---|---|
| `reputation-tests.mts` | every XP source, zero-XP sources (login/likes/reactions/views), quality bands 0–3, simhash tiers + structured-data exception, soft caps (250/500 bands), per-source daily caps, keyed idempotency, reversal/reinstate/final, drift invariants ×3 |
| `rewards3-tests.mts` | path attribution, dual-path events, mastery levels, diversity floors + banked promotion, build titles, unlock gates positive+negative, achievement utility unlocks, 0-XP achievements, streak utility rewards |
| `reputation-referral-integrity-tests.mts` | referral → dual payout, deferred legitimacy, cluster/reciprocal standing controls |
| `check-drift.mts` | xp sum, standing sum, mastery sums, frozen `reputation` invariant |
| `self-service-tests.mts` | cosmetics re-equip rules, legacy keepsakes, rank-chip display |
| `trust-safety-verify.mjs` | standing gates (links/polls/verified/slowmode), grantor floors, reciprocal discount, per-grantor caps, weekly 40 ceiling, recovery, legacyVerified flag, abuse-flag −50 |
| `runtime-verify.mjs` / `forum-verify.mjs` | server-side unlock enforcement (403 + unlockId), rooms gating (rank+standing), MOVE_THREAD regression |
| `terpbot-*` suites | new commands, watch-rule gating, progression intents |
| `reputation-outbox` coverage | `PendingXpReversal` drain/dead/fixpoint |
| Migration validation (script, not suite) | standing seed correctness, freeze integrity, badge archive mapping, spot-check reconciliation |

Fixtures maintain the new invariants (`xp == SUM`, `standing == SUM`,
mastery sums); `db-guard` import; full cleanup.

---

## Phase 16 — Migration / Rollout

Explicit sequence — no step skipped:

1. Design locked ✓ · this plan approved.
2. Feature branches land on `progression-v2` (Phase 1–15 code complete).
3. **Migration dry-run** on a Neon dev branch snapshot of production
   shape — seed script runs against representative fixture data.
4. Test-data validation: fixture users covering every persona (§14)
   run through the economy — expected XP/rank/standing asserted.
5. Full suite: `test:fast` + `test:master` + `test:slow` green on the
   branch.
6. **Staging validation** — Vercel preview + staging DB: exercise award
   paths, quests, unlocks, watch rules, cockpit manually.
7. **Production backup**: Neon snapshot + validated `pg_dump` of the
   listed tables.
8. **Production migration deploy** — code deploys with
   `progression_v2` flag OFF (inert).
9. **Standing seed + verification migration** — `LEGACY_STANDING`
   rows, `legacyVerified` flags, badge archive mapping.
10. **Drift reconciliation** — verify all invariants on production data
    before enablement.
11. **Flag flip** — `progression_v2` ON; XP live, legacy award path
    stops writing (dual-write off).
12. **Post-deploy reconciliation** — re-run drift checks + reconcile
    sweeps at T+1h and T+24h.
13. **Telemetry review** — Phase 18 metrics dashboarded; XP source mix
    sanity-checked vs design.
14. **Rollback conditions** (trip any → flag OFF + assess): drift
    invariant breaks on prod; standing seed mismatch >0.1%; reversal
    outbox stalling; unlock 403s on baseline features.
15. **Legacy freeze verification** — confirm `ReputationEvent` has no
    new rows post-flip; `reputation` static.

---

## Phase 17 — Rollback

| Layer | Rollback behavior |
|---|---|
| Code | Vercel redeploy / flag OFF — trivially reversible pre-flip |
| Schema | New tables are additive — rollback = flag off + leave tables; **never** drop in rollback |
| Standing seed | Reversible — delete `LEGACY_STANDING` rows (keyed, identifiable) |
| `legacyVerified` | Reversible — flag is additive; removal restores pre-migration state |
| Progression data | `ProgressionEvent` rows are append-only — rolling back *code* leaves them; replayed on re-enable; not destructively "rolled back" |
| Unlock flags | Instant — `hasUnlock` respects flags |
| **Forward-fix only** | Already-granted achievements, already-written standing deductions (audit trail) — never deleted, corrected via counter-entries |

---

## Phase 18 — Observability / Telemetry

Metrics (from `BotEvent`-style telemetry + ledger queries — no vanity):

- XP earned / day **by path** and **by source type** (economy mix vs
  design intent — e.g., Community should be the smallest slice).
- Rank distribution + median time-to-Germinated / -Seedling /
  -Harvested.
- Time-to-first-unlock and time-to-Cockpit.
- Unlock utilization (hasUnlock hits vs grants).
- Path diversity (avg # of paths ≥M2 per member; floor-blocked count).
- Standing: distribution, weekly-cap hitters, per-grantor concentration
  p95, reciprocal-discount count.
- Blocked/reduced awards (band-0 voids, dup-withheld, dup-reduced,
  soft-cap clipped) — abuse pressure gauge.
- Reversal rates by type; detector flag rates; recovery grants.
- Achievement completion distribution; streak retention curves.

---

## Phase 19 — Tuning (config-driven, no migrations)

`progression-config.ts` single source: `XP_TABLE` (every value),
`REP_RANKS` thresholds, `MASTERY_LEVELS`, sub-level map, diversity-floor
table, quality band thresholds (150/250 chars, category counts), simhash
tiers (85/95), soft caps (250/500), source daily caps, standing caps
(40/week, 20/source, 30/grantor), grantor floor, recovery window (90d),
`UNLOCKS` registry (all prerequisites), `ACHIEVEMENTS` registry, quest/
challenge/arc definitions + payouts. Economy retunes = config edit +
deploy, no schema change.

---

## Phase 20 — Implementation Order & Dependency Graph

```
Foundation:  Phase 1 schema → Phase 3 engine (awardProgression, bands,
             simhash, caps) → Phase 4 standing → Phase 5 rank engine
             [sequential — each builds on the last]

Then parallelizable:
  ├─ Phase 6 unlock registry + hasUnlock      (needs Phase 5)
  ├─ Phase 7 existing-gate rewiring           (needs Phase 6)
  ├─ Phase 9 achievements                      (needs Phase 3)
  ├─ Phase 10 quests/streaks/arcs              (needs Phase 3)
  ├─ Phase 11 TerpBot                          (needs Phase 6)
  ├─ Phase 12 UI                               (needs Phase 5+6)
  └─ Phase 8 ◆ builds — cheap first            (needs Phase 6 gates)
       → templates/views/reminders/export/filters (independent)
       → analytics family                       (independent)
       → watch rules                            (needs Phase 11 eval)
       → cockpit                                (needs watch+compare)
       → guides/challenges/mentoring            (Layer C, needs standing)

Sequential tail:
  Phase 13 API wiring → Phase 14 cron wiring → Phase 15 tests at each
  step → Phase 16 rollout → Phase 18/19 tuning
```

Unlock enforcement and UI can run fully parallel to ◆ builds — gates
ship first, features fill in behind them.

---

## Phase 21 — Acceptance Criteria

Implementation is complete only when ALL hold:

- [ ] XP economy matches §6 exactly (every source, cap, band, dup tier)
- [ ] Five mastery paths accrue independently; dual-path events pay both
- [ ] Diversity floors enforce banked-promotion behavior
- [ ] Standing is a separate axis: judgment-gated sources only, 40/week
      ceiling, grantor/reciprocal/cluster discounts, recovery, auditable
- [ ] `ReputationEvent`/`reputation`/`Badge`/`UserBadge`/`PendingReversal`
      frozen and intact for audit
- [ ] `Profile.xp == 0` at cutover; standing seeded via `LEGACY_STANDING`
- [ ] `legacyVerified` populated for prior VERIFIED_MEMBERs; Progression
      Verified path live (Respected+30d+no flags)
- [ ] Three-layer unlock model enforced server-side via `hasUnlock`;
      403+unlockId on denial; no UI-only gates on sensitive features
- [ ] Comparison ladder (basic/env/longitudinal) + watch ladder
      (basic/advanced/compound) + Cockpit at Harvested all enforce
- [ ] Every ★ feature rewired to new gates; every ◆ feature meets its
      Phase 8 acceptance row
- [ ] Achievements pay 0 XP; ~40 story-chain items; utility unlocks work
- [ ] `DAILY_LOGIN` = 0 XP; streaks pay utility only
- [ ] Likes/reactions/follows/views write no events to either axis
- [ ] Documented-failure bonus pays only via §6.4a gates
- [ ] Simhash three-tier + prose-only + structured-change exception work;
      withholds audited in meta
- [ ] Reversal/reinstate/final, outbox drain, reconcile sweeps, velocity/
      reciprocal/cluster detectors all ported and passing
- [ ] Three drift invariants pass on dev AND post-migration prod data
- [ ] `test:fast` + `test:master` + `test:slow` green
- [ ] Rollback matrix verified (flag-off safe; forward-fix list honored)
- [ ] Telemetry live: XP-by-source mix readable post-launch
- [ ] No P0/P1 security/privacy regressions
- [ ] Unlock presentation: what/why/how-to-use on every grant
