# TerpTalk Progression V2 — Design & Implementation Plan

**Design revision 2** — economy-first rewrite. The engineering spine from
revision 1 is unchanged and intentionally preserved; this revision rebuilds
the *economy* on top of it: faster early/mid pacing, a complete quality-
weighted XP economy, real path mastery, a much larger functional unlock
catalog, achievements that unlock utility, a hardened standing axis, and a
formal set of economic invariants.

---

## 1. Current-System Audit (read-only — unchanged, carried forward)

### 1.1 Storage

| Model | Role |
|---|---|
| `Profile.reputation` | Denormalized balance (hot reads, leaderboards). Invariant: `reputation == SUM(ReputationEvent.amount)` over ALL rows. |
| `ReputationEvent` | Append-only ledger. `type`, signed `amount`, `reason`, unique `key` (idempotency), `sourceType/sourceId` (bulk reversal), `actorId` (provenance), `reversedAt`, `reversalOfId`, `reversalFinal`. |
| `PendingReversal` | Durable reversal outbox. Intent written inside the mutating transaction; CAS-claimed drains; fixpoint-verified completion; DEAD escalation after 10 attempts. |
| `Badge` / `UserBadge` | Badge definitions (DB rows seeded from registry) and grants. `pinned` = showcase. |
| `Profile.avatarFrame/profileTitle/profileTheme` | Equipped cosmetics (unlock derived from rep). |
| `Profile.chatMessageCount` | Lifetime counter feeding social badges (capped 50/day). |
| `Profile.referredById` | Referral attribution. |
| `AbuseFlag` | Detector hits (REP_VELOCITY, REP_RECIPROCAL_PAIR, REP_RECIPROCAL_ANSWERS, REP_NEW_ACCOUNT_LIKES), keyed per-day. |
| `BotEvent` / `BotSession` | TerpBot telemetry; powers bot-only badges. |

No quest/challenge/journey/streak tables — all derived from the ledger and
live rows. `Setting` gates journeys/grow-journey/weekly-recognition.

### 1.2 Income sources

| Type | Amount | Gate |
|---|---|---|
| THREAD_CREATED | 10 | 3/day, ≥40 chars |
| POST_CREATED | 2 | 10/day, ≥40 chars |
| DIARY_CREATED | 10 | 2/day |
| DIARY_UPDATE | 3 | 5/day + per-diary-per-day key |
| STRAIN_CREATED | 10 | 5/day, ≥120-char description |
| STRAIN_PHOTO | 3 | 5/day, not own strain |
| SETUP_CREATED | 8 | 2/day |
| LIKE_RECEIVED | 2 | 50/day, liker ≥24h old |
| HELPFUL_ANSWER | 30 | 2/day, acceptor ≥24h + ≥10 rep |
| ACCEPT_MARKED | 5 | peer answer must exist |
| REFERRAL | 25 | deferred: referee ≥25 rep + 24h, ≤3/week |
| DAILY_LOGIN | 1 | 1/day |
| ONBOARDING_COMPLETE | 15 | once |
| HARVEST_LOGGED | 25 | once/diary, ≥4 updates |
| CONTEST_WEEKLY_WIN | 50 | weekly |
| CONTEST_MONTHLY_WIN | 150 | monthly |
| QUEST_DAILY | 5–10 +5 perfect-day | derived, keyed, reconciled |
| CHALLENGE_WEEKLY | 10–20 | derived, keyed, reconciled |
| GROW_MILESTONE | 10–50 | per-diary stage gates |
| JOURNEY_COMPLETE | 25 | once |
| STREAK_BONUS | 10–500 | once-ever per rung |
| BADGE_BONUS | 15–250 | once per badge |
| WEEKLY_AWARD | 50 | weekly winner |
| STAFF_ADJUSTMENT | ±≤500 | staff only |
| VERIFIED multiplier | ×1.5 | VERIFIED_MEMBER role |

### 1.3 Ladder, gates, sub-engines, anti-abuse (condensed)

- `REP_TIERS`: 13 tiers (Seed 0 → Master Gardener 50,000) with perk table
  (trustedLinks, polls, verifiedMember, rateLimitBoost, slowmodeExempt,
  imagesPerPost, maxThreadTags, showcaseSlots, questSlots, nameplate).
- `REP_LADDER` (~40 rungs): tier thresholds + in-tier checkpoints → Grow
  Level; once-ever celebrations via 0-amount MILESTONE marker rows.
- Gates: links (150+24h), polls (500), verified (1500+30d → ×1.5 rep),
  rate boosts ×1.5/×2, images 6/8/10, tags 7, quest slots 3/4, showcase
  3→14, Grow Room 3500, Vault 15000, 41 cosmetics, nameplates.
- Sub-engines: 10 daily quests (~30/day), 7 weekly challenges (~90/week),
  Getting Rooted journey (+25), per-diary Grow Journey milestones with
  clawback, check-in streak + grow streak, weekly recognition board +
  Grower of the Week, two contests, deferred referral payouts.
- Trust axis exists (`TRUST_EVENT_TYPES` → 6 standings) but **gates
  nothing** — display only.
- Anti-abuse: keyed idempotency, serializable capped awards, reversal/
  reinstate/final, outbox with fixpoint proofs, self/bot/banned blocks,
  actor-age gates, velocity + reciprocal + new-account detectors,
  quest/challenge/referral reconcile sweeps, drift invariant.
- Evaluation triggers: ~15 award callsites; `/api/ping` evals quests/
  challenges/streaks + drains outbox; `/api/progression` consolidated
  read; `cron/terpbot` runs recognition/reconciles/flags/drift.
- UI: `/progress`, `/reputation`, `/achievements`, `/leaderboard`,
  profile card + cosmetics, member-home next-action. TerpBot: `/rep
  /progress /quests /streak /badge /nextbadges /grow` + announcements.

### 1.4 Why it fails the brief

1. One currency does everything — volume, peer validation, trust
   eligibility, cosmetics — so the number means nothing specific.
2. Rewards are mostly cosmetic (41 items); functional perks are thin.
3. Forum-volume bias — a documented grow update pays 3 while a thread
   pays 10; a non-grower can out-level someone mid-grow.
4. ~90 badges, mostly volume counters — noise, not story.
5. Trust axis is decorative — gates nothing.
6. No mastery identity — a data-nerd, a helper, and a diary-keeper are
   indistinguishable.
7. Likes and check-ins are income — manufactured engagement pays.

---

## 2. What survives — categorization

### KEEP (proven machinery — the strong spine)

- **The ledger pattern** — append-only keyed events, signed counter-entry
  reversals, `reversalFinal`, source/actor sweeps, drift invariant.
- **The outbox** — `PendingReversal` durable-intent mechanics.
- **Derived progress** — quests/streaks/journeys recomputed from rows,
  never stored counters (self-healing under deletion).
- **Deterministic quest selection** — hash-picked rotation.
- **Meaningful-update predicate** — extended into the quality model, §6.3.
- **Velocity/reciprocal/new-account detectors** — retargeted at new types.
- **Reconcile sweeps + cron plumbing.**
- **Referral deferred-payout design.**
- **Notification celebration-metadata pattern.**
- **Perk-threshold lookup helpers** — callsites never index positionally.
- **Feature flags** for every engine.

### REBUILD

- `ReputationEvent` → `ProgressionEvent` (mastery + dual currency, §17).
- Tiers → Ranks + Mastery levels (§5, §7).
- Quests/challenges — new mastery-aligned definitions, same engine (§9).
- Badges → Achievements — utility-bearing milestone chains (§10, §11).
- `/progress`, `/api/progression`, TerpBot progression commands.

### REMOVE

- `DAILY_LOGIN` as XP — **permanently 0 XP** (§9.5, D6).
- `LIKE_RECEIVED` as XP **and** as standing — likes write **no event at
  all** (§6.5, §9.4). Social approval cannot manufacture either axis.
- `VERIFIED_MULTIPLIER` — removed; verified is a standing outcome, not an
  income boost (§9.7, D2).
- Volume-counter badges → replaced by story chains.

### SEPARATE INTO TRUST/SAFETY

- Links, polls, verified, slowmode → standing-gated (§9.6).
- Detectors, AbuseFlag, staff adjustments, `reversalFinal`, unlock freeze.

### REPLACE

- `Badge`/`UserBadge` → `Achievement`/`UserAchievement` (legacy archived).

---

## 3. The two axes — XP vs Standing

| | **Grower Mastery (XP)** | **Community Standing** |
|---|---|---|
| What it is | Progression currency routed into 5 mastery paths | Trust/safety/integrity signal |
| Earned by | Doing meaningful things — growing, recording, teaching, experimenting | Being *validated* — accepted answers, contest wins, qualified referrals, staff grants, upheld reports |
| Grindable | Yes, by design (within caps) | **No** — every standing point requires another human or staff judgment |
| Gates | Unlocks, rank, quest slots, capacity | Links, polls, verified, sensitive permissions |
| Can it fall | Yes — clawed back only for deleted/fake content | Yes — validated reports, resolved abuse flags, staff deductions |
| Displayed | /progress, profile rank chip, mastery bars | Profile standing chip, mod queue context |

Every `ProgressionEvent` row carries `xp` and/or `standing`; a single row
can pay both (`HELPFUL_ANSWER` = +30 Knowledge XP **and** +10 standing).
`Profile.xp` and `Profile.standing` are the two cached balances,
maintained in the same ledger transaction, each with its own drift
invariant.

---

## 4. The reward loop

```
      ACTION                    CONTRIBUTION
   grow / record / teach   →   real artifacts: documented grows,
   / experiment / mentor       structured data, verified answers
        ↓
   XP lands in a mastery path (+ standing on peer-validated work)
        ↓
   MILESTONE — rank-up, path level-up, achievement chain step
        ↓
   UNLOCK — a real capability (analytics, tools, access)
        ↓
   NEW CAPABILITY produces better records, better answers,
   better experiments → more valuable contribution → loop repeats
```

Concrete example: a grower logs structured env data → Records XP → M2
unlocks coverage insights → they see which metrics they're missing →
logs them → higher coverage score → TerpBot longitudinal analysis gets
deeper → their next unlock (experiment analysis) shows whether their
changes worked → the data they produce is now the platform's evidence
moat. Utility compounds; XP is the *routing mechanism*, not the prize.

Design contract: **the player should always be one ordinary week away
from something they want.** Early ranks unlock capability fast; prestige
ranks are far apart and rare.

---

## 5. Progression curve — 13 ranks

### 5.1 The ladder

| # | Rank | Cumulative XP | XP from prev | Era |
|---|---|---|---|---|
| 1 | **Seed** | 0 | — | — |
| 2 | **Germinated** | 60 | 60 | Propagation |
| 3 | **Seedling** | 180 | 120 | Propagation |
| 4 | **Rooted** | 420 | 240 | Propagation |
| 5 | **Vegged** | 900 | 480 | Vegetative |
| 6 | **Trained** | 1,600 | 700 | Vegetative |
| 7 | **Preflower** | 2,600 | 1,000 | Transition |
| 8 | **Flowering** | 4,000 | 1,400 | Bloom |
| 9 | **Ripening** | 5,800 | 1,800 | Bloom |
| 10 | **Harvested** | 7,500 | 1,700 | Post-harvest |
| 11 | **Cured** | 12,000 | 4,500 | Post-harvest |
| 12 | **Cultivator** | 17,000 | 5,000 | Mastery |
| 13 | **Master Cultivator** | 23,000 | 6,000 | Mastery |

Design intent: Seed→Vegged is onboarding-paced (days–weeks); Vegged→
Flowering is the habit loop (months); Ripening→Cured is committed-grower
territory (a year+); Cultivator→Master Cultivator is prestige (rare,
multi-year, visibly scarce).

### 5.2 Sub-levels — "Grow Levels"

The existing mechanism survives: named checkpoints inside each rank gap.
3 checkpoints per gap in the Propagation/Vegetative eras (fast feedback),
2 per gap in Bloom, 1 per gap in Post-harvest/Mastery → ~36 rungs →
**Grow Level 1–36**. Checkpoint names reuse grow vocabulary:
Germinating/Cracked/Tailed · Cotyledon/First Node/Established ·
Rootbound/Anchored/Taking Hold · Stretching/Stacking/Training ·
Preflowering/Pistils · Budding/Stacking/Frosting · Swelling/Foxtailing/
Flushing · Chopping/Drying/Bucking · Jar Cure/Burping · Pheno Selection/
Mother Keeper · Head Table. A dedicated grower ticks a sub-level roughly
weekly through mid-game — the progress bar is never still.

### 5.3 Calendar pacing by persona

Weekly XP estimates use §6's economy; see §14 for full journeys.

| Persona | ≈XP/wk | Rooted | Vegged | Flowering | Harvested | Cultivator | Master Cultivator |
|---|---|---|---|---|---|---|---|
| A. New member (first month ~90/wk incl. onboarding+arcs) | ~90 wk1-4 | wk 3 | — | — | — | — | — |
| B. Casual (1 grow/season, light forum) | ~35 + grow arcs ~350/season (~60 eff.) | wk 7 | ~4 mo | ~16 mo | ~2.5 yr | ~5 yr | ~7 yr (rare) |
| C. Dedicated grower | ~120 avg incl. arcs | wk 4 | wk 7 | ~7 mo | ~14 mo | ~32 mo | ~3.7 yr |
| D. Expert contributor (grows + answers + guides) | ~200 | wk 2 | wk 4 | ~5 mo | ~9 mo | ~20 mo | ~2.2 yr |
| E. Abuser (max effort, low quality) | ~35 effective + flags | wk 10+ | ~6 mo | stalled ~never (reversals) | never | never | never |

Note: Harvested was deliberately pulled in to ~7,500 XP so the flagship
Cockpit unlock lands mid-late game (~14 months dedicated) rather than
late game; Master Cultivator at 23,000 keeps the apex multi-year-prestige
without being unreachable.

Reads: early game moves for everyone; the mid-game separates growers
from visitors; Cultivator+ is genuinely scarce — even an expert needs
~2 years. Dedicated growers always out-pace abusers by ~3–4× effective
XP, before moderation even looks.

### 5.4 Rank diversity floors

Rank promotion requires XP **and** breadth — the "Balanced Growth" rule
(prevents a single-activity specialist from speed-running the tree):

| Rank | Also requires |
|---|---|
| Seed → Preflower | XP only — specialization is free early |
| Flowering | Any 2 masteries ≥ M2 (150 each) |
| Ripening | Any 2 masteries ≥ M3 (350 each) |
| Harvested | Any 3 masteries ≥ M3 |
| Cultivator | Any 3 masteries ≥ M4 (750 each) |
| Master Cultivator | 1 mastery ≥ M6 (3,000) + 2 ≥ M4 |

XP earned while a floor is unmet is **banked** — the rank-up applies
automatically when the floor clears. A pure grower is never blocked from
*earning*; they're nudged to branch out before the prestige tiers, which
is exactly when "real grower" should mean more than "posts a lot."

### 5.5 Why each rank matters ("why should I care?" test — expanded)

Every rank must clear the bar: ≥1 meaningful **functional** reason a real
member would want it. Cosmetic items may accompany a rank but never
carry it.

| Rank | Primary meaningful reward | Secondary | Path relationship | What you can newly do |
|---|---|---|---|---|
| **Seed** | Baseline toolset (forums, chat, 3 grows, diaries, TerpBot Q&A) | — | — | Participate fully; nothing needed to start |
| **Germinated** | Grow summaries + streak dashboard | +1 saved search (3) | — | See your grow distilled into a summary card |
| **Seedling** | **Basic grow comparison** (vs community medians) | +1 comparison slot (2) | — | Benchmark your numbers against real peer grows |
| **Rooted** | **Grow templates** (prefilled update forms) | +1 quest slot (4), saved views | — | Log structured updates in seconds, not minutes |
| **Vegged** | **Environmental analytics** (30/90d env graphs, VPD split) | Advanced env comparison; grows→6, searches→6 | Records M2 | Read your environment over time AND against peers |
| **Trained** | **Export tools** (diary + data, JSON/CSV) | Advanced filter facets; searches→10; custom reminders | Records M2 | Own/port your data; find strains & gear precisely |
| **Preflower** | **TerpBot basic watch** (3 single-metric alert rules) | — | — | Get proactively alerted when conditions drift |
| **Flowering** | **Longitudinal + multi-grow analysis** (episodes, baselines, cross-grow compare) | Images→6 | Diversity floor: 2 paths ≥ M2 | Analyze a whole grow's arc; compare grows to each other |
| **Ripening** | **Leadership tools** — guide authoring (or Knowledge M3), challenge creation (or Community M4), mentoring (Knowledge M3+Trusted) | Nutrient schedules (Records M3); rate ×1.5 | First path-gated specialist tools | Publish knowledge, run challenges, mentor newcomers |
| **Harvested** | **Grower Cockpit** — pinned grows, alerts, comparisons, quest board in one command view | Advanced TerpBot watch (10 rules, Records M3); experiment analysis; images→8; grows→15 | — | Manage your whole grow operation from one surface |
| **Cured** | **Historical trends** — current grow vs your own history | Advanced dashboards; watch→15; rate ×2; tags→7 | Records M4 (trend depth) | Learn across your own seasons, not just within one |
| **Cultivator** | **Grow Room** access + community-evidence views | +1 quest slot (5); images→10 | 3 paths ≥ M4 required | Enter the trusted growers' space; see anonymized aggregate patterns |
| **Master Cultivator** | **The Vault** + research aggregates + early-access flags | Apex identity cosmetics | 1 path ≥ M6 + 2 ≥ M4; Respected standing | Reach the apex: frontier tools and genuine scarcity |

Every rank passes: each has at least one functional capability the
member could not meaningfully exercise before. No rank leans on
title/color/badge.

---

## 6. The complete XP economy

Format: `[XP] path — gate/cap`. Events can pay multiple paths (noted).

### 6.1 Cultivation 🌱 — the act of growing

| Action | XP | Gates/caps |
|---|---|---|
| Diary created | 15 | 3/day |
| Meaningful update-day (per diary) | 5 base | existing predicate; ≤5 update-days/day account-wide |
| Rich update-day (band 2, §6.3) | +3 | replaces nothing — added to base |
| Exceptional update-day (band 3) | +6 | supersedes band 2 bonus |
| Stage milestone: Established / Vegging / Flowering | 15 / 25 / 40 | existing meaningful-day + elapsed-day gates |
| Harvest logged | 50 | ≥4 updates |
| Grow completed (harvest + yield + rating + notes) | +50 | once/diary — the big single payout |
| Season finisher (≥10 meaningful days + ≥60 elapsed days) | +25 | once/diary |

### 6.2 Records 📓 — the quality of documentation

| Action | XP | Gates/caps |
|---|---|---|
| Structured category on an update-day — env metrics / nutrient rows / photos / advanced metrics (runoff, PPFD, lamp distance, CO₂, substrate) | +2 per category, cap +6/update-day | server-validated ranges |
| First-time metric series — first time you ever log each metric family (temp, RH, VPD, pH, EC, runoff, PPFD, photoperiod, height, watering, CO₂, night-temp) | +5 each, once ever | exploration reward — ~60 XP lifetime |
| Setup showcase with structured fields | 10 | 2/day |
| Strain photo | 4 | 5/day, not own strain |
| Coverage milestone — diary reaches ≥70% structured update-days | +25 | once/diary |
| Complete harvest report (yield+rating+difficulty+notes+photo) | +30 | once/diary |

### 6.3 Knowledge 💡 — teaching & reference

| Action | XP | Gates/caps |
|---|---|---|
| Substantive answer (reply ≥200 chars in others' threads) | +4 | 5/day; ALSO pays Community +2 (dual-path) |
| Accepted answer | +30 XP **and** +10 standing | 2/day; grantor-age/standing floor (§9.4) |
| OP marks accepted answer (curation) | +5 | another member's answer must exist |
| Accepted answer in a newcomer's thread (<30d author) | +10 bonus | stacks with accepted |
| Guide published | +50 | authoring is unlock/staff-gated |
| Guide improvement accepted (edit merged) | +15 | editor/peer accepted |
| Strain added with source link | +10 | 5/day, ≥120-char description |
| Problem resolved & documented (ISSUE_RESPONSE experiment completed) | +20 | experiment path |

### 6.4 Experimentation 🔬 — the scientific habit

| Action | XP | Gates/caps |
|---|---|---|
| Experiment created (PLANNED→ACTIVE) | +5 | 2/week |
| Hypothesis documented (`expected` ≥20 chars) | +5 | once/experiment |
| Completed with outcome + conclusion ≥40 chars | +25 | grower-stated outcome |
| **Documented failure** — DID_NOT_WORK/ABANDONED meeting the §6.4a structured requirements | +8 | documentation bonus, not a failure bounty |
| ≥3 linked follow-up updates | +10 | once/experiment |
| Replication — a second grow completes a previously-WORKED experiment | +20 | once per replicated experiment |

#### 6.4a Documented-failure requirements (anti-fabrication)

The +8 bonus rewards *valuable documentation of a real failed attempt*,
never failure itself. All conditions must hold — verified
deterministically at award time:

- Experiment reached ACTIVE status ≥24h before the failing outcome was
  set (a same-hour "create → fail" is a trivial action, not an attempt);
- ≥1 linked diary update OR a documented hypothesis (`expected` ≥20
  chars) exists — something was genuinely tried and tracked;
- conclusion ≥40 chars describing what happened/what was learned;
- **Uniqueness**: the experiment's simhash (title+method+expected) is
  <95% similar to any prior experiment by the same author — identical
  re-created "failures" pay nothing;
- **Cooldown**: max 2 documented-failure bonuses per ISO week per user —
  honest growers rarely exceed it, farmers bounce off it;
- All withheld awards are recorded in `meta` with the reason.

A real failed experiment with notes still earns its normal path XP
(create/hypothesis/follow-ups); the +8 is only the bonus for writing up
the loss honestly.

### 6.5 Community 🤝 — participation & glue

| Action | XP | Gates/caps |
|---|---|---|
| Substantive thread (≥40 chars, real topic) | +8 | 3/day |
| Reply in others' threads | +2 | 10/day |
| Newcomer-thread reply bonus | +3 | author <30 days |
| Contest entry | +5 | per period |
| Contest win (weekly/monthly) | +50 / +150 **and** +10/+20 standing | peer-voted |
| Qualified referral | +25 **and** +15 standing | deferred legitimacy payout |
| Mentoring session (Knowledge M3 unlock — accepted answer via mentor queue) | +5 bonus | stacks with accepted |

**Community is deliberately the lowest-value path.** Socializing is the
cheapest thing to fake, so it should never outpace growing, recording,
or teaching.

### 6.6 Zero / near-zero XP — explicit non-sources

| Activity | Pays |
|---|---|
| Login / check-in (`DAILY_LOGIN`) | **0** — streak mechanic only |
| Profile views, follows, bookmarks | **0** — no events written |
| Likes given / likes received | **0 both axes** — no events written; likes become a pure UI courtesy |
| Reactions (FIRE/LOVE etc.) | **0** |
| "Nice grow"-tier comments (<40 chars) | **0** — below the paying floor |
| Repetitive/near-duplicate posts | **0** — simhash withholding (§6.7) |
| Own-thread replies, self-interactions | **0** — self-award block |
| Running a comparison / viewing analytics | **0** — view actions never pay; *documenting findings* pays via Experimentation |
| TerpBot interaction | **0** — never progression input |
| Contest voting | **0** — quest objective only |

### 6.7 The deterministic quality model

No AI, no opaque score — banded, inspectable rules applied inside the
award call.

**Update quality bands** (applies to diary updates; base + band bonus):

| Band | Rule | Bonus |
|---|---|---|
| 0 — void | fails meaningful-update predicate | 0 XP (update still posts) |
| 1 — basic | meaningful (≥10 chars OR photo OR metric/nutrient/feeding/training field) | base 5 |
| 2 — rich | ≥150 chars AND ≥1 structured category, OR ≥3 structured categories | +3 |
| 3 — exceptional | ≥250 chars AND ≥2 structured categories, ≥1 of which is numeric env/nutrient data, AND ≥1 photo | +6 |

**Post/answer quality:**
- <40 chars → 0. ≥40 → base. ≥200 in others' threads → +2 Knowledge.
- Answers that get accepted pay the big award — quality is ultimately
  peer-judged where it matters most.

**Repetition (deterministic, three-tier):** simhash of the update/post
prose vs the author's own last-30-day content:

| Similarity | Treatment | Audit |
|---|---|---|
| ≥95% | Award withheld entirely (0 XP) — near-certain duplicate | `meta.dup = "withheld"` + matching sourceId |
| 85–94% | Quality/structured bonuses withheld; base pays only if the row contributes genuinely new structured data (changed metric values, new photo, new nutrient row); otherwise 0 | `meta.dup = "reduced"` + reason |
| <85% | No duplicate penalty | — |

**Context exceptions** (so honest logging is never punished):
- Simhash runs on the **prose field only** — recurring structured
  measurements (temp/RH/pH rows), template forms, and stage names are
  excluded from the similarity input.
- An update whose prose is similar but whose *structured data differs*
  (any metric value changed, photo added, nutrient row changed) keeps
  its band-2/3 bonus — the record is new even when the words are not.
- Legit recurring diary entries ("day 42 — same feed") always keep the
  band-1 base 5 XP once per diary-day; the mechanism only removes
  *bonuses* or identical re-posts.

Every withheld/reduced award writes its reason into
`ProgressionEvent.meta` (or a 0-amount marker row if nothing paid) so the
decision is reconstructable.

**Cooldowns:** per-source daily caps (§6.1–6.5) + per-diary-per-day keys
+ quest/challenge period keys.

### 6.8 Diversification — how one activity can't dominate

Three mechanisms, each simple:

1. **Per-source daily caps** (above) — the biggest single-day earner is
   bounded (e.g., posts cap at 20 Community XP/day before quality).
2. **Per-mastery weekly soft caps** — self-driven XP in one mastery:
   full rate to 250 XP/ISO-week, 50% 250–500, 25% beyond 500. Peer-
   gated sources (accepts, contests, referrals) are exempt — they're
   already human-limited. Enforced inside the award transaction by
   counting that mastery's week-to-date rows.
3. **Rank diversity floors** (§5.4) — prestige requires ≥2–3 developed
   paths, so a one-dimensional grinder hard-stops at Flowering while a
   rounded grower sails through.

Result: specialists exist and thrive, but the apex requires a real
grower's breadth.

---

## 7. Path mastery — building a cultivation identity

### 7.1 How it works

- Every XP award is tagged with a mastery (or `SYSTEM` for
  journey/quest payouts that credit a named path anyway — see below).
- `MasteryProgress` caches 5 per-path balances; levels derived.
- Profile shows **rank + top-2 masteries as a "build"**: the visible
  identity is e.g. "Harvested · Cultivator V" not "12,348 points."
- Mastery levels: **M1–M10** at path-XP thresholds
  `50 / 150 / 350 / 750 / 1,500 / 3,000 / 6,000 / 10,000 / 16,000 / 24,000`.
  M6+ is years-deep specialization; M10 is deliberately near-legendary.

### 7.2 Build titles (displayed, not just counters)

| Dominance pattern | Title |
|---|---|
| Cultivation alone ≥70% of path XP | Cultivator |
| Records alone ≥70% | Record-Keeper |
| Knowledge alone ≥70% | Sage |
| Experimentation alone ≥70% | Experimenter |
| Community alone ≥70% | Pillar |
| Cultivation + Records | Data-Driven Cultivator |
| Cultivation + Knowledge | Grow Mentor |
| Records + Experimentation | Research Grower |
| Knowledge + Community | Community Sage |
| Any 3+ within 40% | All-Rounder |

"Within-30% pair" = hybrid; checked at profile render, pure math.

### 7.3 Do paths gate things?

Yes — deliberately (§8): some unlocks accept *either* a rank or a path
(e.g., guide authoring = Ripening **or** Knowledge M3) so a specialist
reaches their tools without grinding the whole ladder. Rank diversity
floors cap *prestige*, never *tools a specialist legitimately needs*.

### 7.4 Path diminishing returns

The §6.8 weekly soft caps are per-path — no path accelerates forever,
but 250 XP/week/path is generous enough that honest users rarely feel
it (a dedicated grower's best week spreads ~120–160 across 2–3 paths);
it's an abuser-shaped wall, not a productivity ceiling.

---

## 8. The unlock catalog — rewards worth leveling for

Categories: **F**unctional · **Cv** convenience · **Cp** capacity ·
**A**nalytics/data · **T** TerpBot · **L** community/leadership ·
**Cs** cosmetic · **P** prestige. ★ exists & needs gating · ◆ new build.

**The three-layer gating model** (central rule — every unlock declares a
layer):

- **Layer A — Core**: global rank alone. Own-data, zero-community-surface
  tools. e.g., grow templates, exports, saved views.
- **Layer B — Specialized**: global rank **+ relevant path mastery**.
  Data-intelligence tools that should reward the behavior that feeds
  them. e.g., env analytics = Vegged + Records M2; multi-grow comparison
  = Flowering + Records M2; nutrient schedules = Records M3.
- **Layer C — Sensitive/community**: global rank **+ path mastery +
  Standing**, where the unlock touches other members. e.g., mentoring =
  Ripening-rank OR Knowledge M3 + Trusted; Grow Room = Cultivator +
  Trusted; The Vault = Master Cultivator + Respected.

The rule's purpose: you can't grind one unrelated activity and unlock
everything — the ladder checks that your build matches the tool.

**Baseline (all members, never gated):** forums, chat, 3 active grow
diaries, diary updates, basic stage timeline, 2 saved searches, standard
images, TerpBot Q&A + /grow + /streak, symptom/problem help, all
account/safety features. Safety-critical functions are never gated.

### 8.1 Early game

| Unlock | Cat | Layer | Req | ★/◆ | Notes |
|---|---|---|---|---|---|
| Streak dashboard + grow summaries | A | A | Germinated | ★ | session-1 payoff |
| +1 saved search (3) | Cp | A | Germinated | ★ | capacity flavor early |
| **Basic grow comparison** (your grow vs community medians) | A | A | Seedling | ★ `buildGrowComparison` exists | first "wow" tool |
| +1 comparison slot (2 concurrent) | Cp | A | Seedling | ◆ | |
| Grow templates (prefilled update forms per medium/method) | F | A | Rooted | ◆ | makes logging faster |
| +1 daily quest slot (4) | F | A | Rooted | ★ engine exists | |
| Saved views (custom diary/feed filters) | Cv | A | Rooted | ◆ | |

### 8.2 Mid game

| Unlock | Cat | Layer | Req | ★/◆ | Notes |
|---|---|---|---|---|---|
| **Environmental analytics** — 30/90-day env graphs, VPD day/night split | A | B | Vegged + Records M2 | ◆ (env-chart exists; ranges new) | rewards the logging that feeds it |
| **Advanced env comparison** — overlay your env data vs peer medians | A | B | Vegged + Records M2 | ◆ | comparison ladder step 2 |
| Harvest analytics (yield trends, rating stats) | A | A | Vegged | ◆ | |
| Saved searches → 6; active grows → 6 | Cp | A | Vegged | ◆ | |
| Export tools (diary + data, JSON/CSV) | F | A | Trained | ◆ | data portability |
| Advanced strain/equipment filter facets | F | A | Trained | ◆ | discovery depth |
| Saved searches → 10 | Cp | A | Trained | ◆ | |
| Custom reminders (deterministic — "check runoff pH every 3 days") | F | A | Trained | ◆ | |
| **TerpBot basic watch** — 3 single-metric threshold rules ("VPD out of range 3 days running") | T | A | Preflower | ◆ | deterministic; never LLM; safety alerts never gated |
| **Longitudinal analysis** — episodes, baselines, timeline review | T | B | Flowering + Records M2 | ★ intel engine exists | deep-dive gate |
| **Multi-grow / longitudinal comparison** — compare grows to each other | A | B | Flowering + Records M2 | ◆ | comparison ladder step 3 |
| Images per post → 6 | Cp | A | Flowering | ★ | |

### 8.3 Late game

| Unlock | Cat | Layer | Req | ★/◆ | Notes |
|---|---|---|---|---|---|
| **Guide authoring** | L | B | Ripening **or** Knowledge M3 | ◆ | review queue on publish |
| **Challenge creation** — member-run challenges w/ join tracking | L | B | Ripening **or** Community M4 | ◆ | |
| **Mentoring tools** — unanswered-question routing, helper flair | L | C | Knowledge M3 + Trusted **or** Ripening + Trusted | ◆ | bounded daily assists |
| Nutrient schedules (brand presets, feed charts) | F | B | Records M3 | ◆ | path-gated specialist tool |
| Data-quality insights (coverage score, missing-metric hints) | A | B | Records M2 | ◆ | |
| Experiment templates (clone an experiment structure) | F | B | Experimentation M2 | ◆ | |
| Rate limits ×1.5; images → 8 | Cp | A | Harvested | ★ | |
| **Grower Cockpit** — pinned grows, alerts, comparisons, quest board | F | A | Harvested | ◆ | flagship — see §8.4a |
| **Advanced TerpBot watch** — 10 rules + multi-day conditions | T | B | Harvested + Records M3 | ◆ | watch ladder step 2 |
| **Compound watch rules** — multi-condition logic (env × nutrient × stage) | T | B | Records M4 | ◆ | watch ladder step 3 — path-gated, rank-agnostic |
| Experiment analysis — aggregate your completed experiments | T | B | Harvested + Experimentation M2 | ◆ | |
| Historical trends — grow vs your own history | A | B | Cured + Records M4 | ◆ | |
| Advanced dashboard widgets; watch rules → 15 | A/T | A | Cured | ◆ | |
| Rate limits ×2; thread tags → 7 | Cp | A | Cured | ★ | |

### 8.4 Prestige

| Unlock | Cat | Layer | Req | ★/◆ | Notes |
|---|---|---|---|---|---|
| The Grow Room | L | C | Cultivator + Trusted | ★ exists | |
| Community-evidence views — anonymized aggregate patterns (k-anonymized, existing min-sample rule) | A | C | Cultivator + Trusted | ◆ | privacy-by-construction |
| +1 quest slot (5); images → 10 | Cp | A | Cultivator | ★ | |
| The Vault | L | C | Master Cultivator + Respected | ★ exists | |
| Research aggregates (deeper anonymized stats) | A | B | Master Cultivator + Records M4 | ◆ | |
| Early-access feature flag | P | A | Master Cultivator | ◆ | |
| Apex cosmetics (Northern Lights frame, Master title) | Cs | A | rank track | ★ | |

#### 8.4a Why the Cockpit is the flagship

Grower Cockpit is not "another dashboard page" — it is the point where
TerpTalk stops being a place you *visit* and becomes a tool you *operate
from*: your active grows, watch alerts, comparisons, quests, and pending
follow-ups in one surface. Placing it at Harvested (~14 months for a
dedicated grower) is deliberate: it rewards the member who has completed
at least one full grow cycle and documented it, and it immediately makes
the *next* grow easier to run well. It is the unlock where progression
visibly changes how a member uses the product.

#### 8.4b The comparison feature ladder

Comparison capability deliberately evolves across three ranks rather
than appearing whole:

1. **Seedling — basic**: your grow vs community medians (existing
   `buildGrowComparison`).
2. **Vegged — advanced env**: overlay your env/measurement series
   against peer aggregates (Records M2 — you've logged the data that
   makes overlay meaningful).
3. **Flowering — longitudinal/multi-grow**: compare whole grows against
   each other and against your own history windows.

Each step presumes (and rewards) better record-keeping — the tool gets
smarter as your data gets richer.

### 8.5 Abuse & privacy review of permission rewards

- **Own-data unlocks** (analytics, exports, cockpit, trends) — zero
  community surface; safe by construction.
- **Rate/capacity relaxations** — multipliers on existing limits, never
  exemptions; staff-reversible via unlock freeze.
- **Community-surface unlocks** (guides, challenges, mentoring) — carry
  standing floors, normal rate limits, review queues; a reversed
  member's published content un-earns nothing *except* it can be
  moderated like any content.
- **Standing-gated access rooms** — rank alone never suffices.
- **Unlock freeze flag** — staff can suspend unlocks per-user without
  touching earned XP (new `ProgressionEvent`-adjacent flag on Profile).

### 8.6 Unlock density audit — no dead zones

Walking the full ladder, every gap between major ranks contains
progression feedback — this is a feel requirement, not a rewards-per-XP
quota:

| Gap | What happens inside it |
|---|---|
| Seed → Germinated (60) | Onboarding + first diary + first quests — unlock lands inside session one |
| Germinated → Seedling (120) | Saved search; journey steps fire; sub-level ticks ~every 40 XP |
| Seedling → Rooted (240) | Comparison slots; First Grow arc steps; sub-levels |
| Rooted → Vegged (480) | Quest slot 4, templates, saved views; mastery M1→M2 titles; Journaler chain steps |
| Vegged → Trained (700) | Env analytics absorbed; Records/Knowledge M2 milestones; coverage insights (Records M2) |
| Trained → Preflower (1,000) | Exports/filters/reminders settle in; M3 path levels; achievement chains (Triple Harvest, Lab Notes) |
| Preflower → Flowering (1,400) | Watch rules in daily use; milestone achievements; diversity-floor chase begins |
| Flowering → Ripening (1,800) | Longitudinal analysis; multi-grow comparisons; path M4 milestones; leadership eligibility visible |
| Ripening → Harvested (1,700) | Guides/challenges/mentoring live; Greenlight-style achievement unlocks; cockpit anticipation |
| Harvested → Cured (4,500) | Cockpit ownership phase + advanced watch + experiment analysis; path M4–M5 rungs; grow-over-grow data accumulates into the Cured payoff |
| Cured → Cultivator (5,000) | Historical trends in use; prestige achievements; standing climbs toward Trusted/Respected |
| Cultivator → Master (6,000) | Prestige era — intentionally sparse; path M6, rare achievements, Elder standing carry the gap |

Identified soft spots and fixes applied: the two Mastery-era gaps are
long by design (prestige), and are padded by path milestones, rare
achievements, standing progression, and achievement-granted tools — not
left empty.

---

## 9. Standing — the trust axis, hardened

### 9.1 Sources (all require another human or staff judgment)

| Signal | Standing |
|---|---|
| Accepted answer (your reply accepted by OP) | +10 |
| Accepted answer in newcomer thread | +12 |
| Contest win (weekly/monthly, peer-voted) | +10 / +20 |
| Qualified referral (referee proves legitimate) | +15 |
| Guide published (staff/peer reviewed) | +10 |
| Staff grant (bounded ±; reason required) | ± |
| Report upheld (your report → valid moderation action) | +5 |

### 9.2 Negative signals

| Signal | Standing |
|---|---|
| Upheld report against you | −20 |
| Resolved abuse flag against you | −50 |
| Staff deduction (bounded) | − |
| Mass reversal event (≥5 content items clawed back in a sweep) | −15 |

Balance clamps at ≥0 — standing can't go negative.

### 9.3 Why it resists farming

- **No like/comment volume input at all** — the classic farm vectors
  write nothing.
- Every source is **peer- or staff-gated**: you cannot mint standing
  alone. Accepts require the OP's choice; contests require votes;
  referrals require a *real* new member; reports require staff
  agreement.
- **Grantor floors**: an accept from a sub-Trusted account pays half
  standing (5) — sock accepts decay to ~0 once flagged; age gates stay.
- **Weekly ceiling**: standing income ≤**40/week** from member-driven
  sources (staff grants exempt — the documented exceptional pathway);
  excess simply doesn't accrue — quiet ceiling.
- **Source-specific controls** (so no single vector supplies a member's
  standing):
  - *Per-grantor diminishing*: the first standing award from a given
    grantor (actor) pays full; subsequent awards from the same grantor
    within 90 days pay half; per-grantor lifetime contribution caps at
    30 standing — one champion can never carry your reputation.
  - *Reciprocal discount*: if the grantor received standing from you in
    the last 90 days, the award pays **0 standing** (XP still pays —
    the answer was still good — but trust doesn't round-trip). The
    existing reciprocal-accept detector flags the pair.
  - *Cluster discount*: if ≥60% of a member's trailing-90-day standing
    came from a single interconnected grantor cluster (shared
    reciprocal edges), new in-cluster awards are discounted to 0 and an
    `AbuseFlag` rows for review.
  - *Repetition discount*: contest/referral/report sources each cap at
    20 standing per ISO week — no single source type dominates.
  - *Coordinated patterns*: velocity + reciprocal detectors feed
    `AbuseFlag`; resolved flags apply −50 and claw back the standing
    the pattern produced.
- **Detectors unchanged**: reciprocal accept-pairs, like rings (now
  worthless anyway), new-account likes, velocity — all still flag.
- **No decay** (trust doesn't rot from inactivity) but **recovery
  exists**: 90 flag-free days after a −50 flag restores +25 (once per
  flag) — redemption, not erasure; recorded as `STANDING_RECOVERY`
  rows, auditable.
- **Reversals mirror XP**: accepted-answer standing is clawed back when
  the answer/post is deleted or the accept is reversed.

### 9.4 Standings (renamed vocabulary)

**Unknown (0) → Known (25) → Trusted (100) → Respected (300) →
Pillar (800) → Elder (1,500).**

### 9.5 What standing unlocks

| Gate | Standing |
|---|---|
| Post external links | Known (25) + 24h age |
| Vote in polls | Known |
| Create polls | Trusted (100) |
| **Progression Verified** | Respected (300) + 30d + no unresolved flags |
| Slowmode exempt | Pillar (800) |
| Grow Room | Cultivator rank + Trusted |
| The Vault | Master Cultivator rank + Respected |
| Mentoring tools | Trusted + Knowledge M3 |
| Staff-application eligibility signal | Respected+ shown to reviewers |

### 9.6 Verified transition — `Legacy Verified` vs `Progression Verified`

- **Legacy Verified**: accounts holding `VERIFIED_MEMBER` at cutover
  keep the role with a `legacyVerified` marker. Permits exactly what
  Progression Verified permits (no XP multiplier either way — it's
  gone). **Revocable for ordinary trust/safety reasons** — bans,
  resolved abuse flags, or standing collapse remove it identically to
  any standing-gated status; revocation is audited (SecurityEvent +
  staff action row). No re-qualification required — it's a kept
  promise, not a permanent privilege.
- **Progression Verified**: the new path — standing ≥ Respected (300) +
  30-day account + no unresolved abuse flags. Auto-promotes on
  qualifying events; auto-demotes if standing falls below Trusted
  (buffer to avoid flap) or a flag lands unresolved.
- Display: both show "Verified" with a tooltip distinguishing
  "Verified since early TerpTalk" vs "Earned through community trust."
- Audit: role transitions write SecurityEvents; standing-gate checks
  are deterministic ledger sums — fully reconcilable.

---

## 10. Quests V2

### 10.1 Daily quests (3 slots → 4 at Rooted → 5 at Cultivator)

Mastery-tagged, ~15 XP/day — seasoning, not the loop. Same hash
selection, keyed payout, recompute-derived progress, sticky-payout
reconcile. Pool:

- Log a grow observation (Cultivation +5)
- Record an environmental measurement (Records +6)
- Add a structured nutrient row (Records +6)
- Note a training action (Records +5)
- Reply in someone's thread (Community +5)
- Help a member <30 days old (Community +8)
- Answer an unanswered question (Knowledge +8)
- Review a past update & note the change (Records +5)
- Log a stage transition (Cultivation +6)
- Run a grow comparison (Experimentation +5 — **appears only if
  unlocked**, §8) 

### 10.2 Weekly arcs

~40 XP/week, same engine: tend diary 3 days (fixed); multi-day
updates; a substantive answer (bonus if accepted); 3+ env readings
across the week; a comparison or experiment step; help a newcomer;
contest participation; quest sweep (5+ dailies).

### 10.3 Long journeys (three tracks, derived, keyed payouts)

- **First Grow** — create diary → 3 meaningful days → stage change →
  harvest → complete report. +25/step. The activation journey.
- **Data-Rich Grower** — structured-day streaks, coverage milestones,
  every metric family logged.
- **The Helper** — first substantive answer → first accept → accepts
  for 5 distinct members → newcomer assists.

### 10.4 Streaks — habit mechanics, not income

Check-in streak pays **0 XP** permanently (D6). Milestone rewards are
**utility, not currency**:

| Streak | Reward |
|---|---|
| 3 days | "Tend" achievement step |
| 7 days | Unlocks a one-off bonus quest (+15 XP on completion — the quest pays, not the streak) |
| 30 days | **+1 quest slot for the following week** (temporary utility, expires) |
| 60 days | Streak achievement + profile flame |
| 100 days | Rare cosmetic frame |
| 365 days | "Evergreen" prestige achievement + permanent cosmetic |

Grow streak (meaningful update-days) is the meaningful one — it feeds
Cultivation quests and the Journaler chain.

---

## 11. Achievements — story that unlocks utility

### 11.1 Philosophy

- **Achievements pay 0 XP** (D7). They unlock *utility, access,
  identity* — they are the alternative-ladder to capability for
  accomplished members.
- ~40 items, **chains not counters**: each family is 3–5 rungs of an
  actual story. No "post 100 times."
- Rarity means something: common = reachable by any engaged member;
  rare = real effort; epic = peer-validated or sustained; legendary =
  years or genuinely scarce.

### 11.2 Utility-bearing achievements (the new mechanic)

| Achievement | Requirement | Unlocks |
|---|---|---|
| First Harvest | Complete 1 grow (harvest + report) | **Grow Summary** — public grow recap card |
| Triple Harvest | 3 completed grows | **Harvest Comparison** — compare your harvests |
| Lab Notes | First completed experiment | **Experiment Log** view |
| Replicated | Replicate a WORKED experiment | Experiment comparison analytics |
| Greenlight | 10 accepted answers | **Mentor tools** (alt path to M3 gate) |
| Full Spectrum | Log every metric family at least once | **Coverage insights** (alt to Records M2) |
| Perfect Record | ≥90% coverage on a completed diary | High-evidence diary marker (boosted in evidence views) |
| Mentor | Accepts for 25 distinct members | Mentor flair + routing priority |

### 11.3 Families (~40 total)

- **Milestone** (rank journey): Germinated → Master Cultivator steps.
- **Cultivator**: 1/3/10 grows · season-spanner · first harvest.
- **Journaler**: 10/50/150/365 meaningful update-days · 30/90-day grow streak.
- **Harvester**: 1/3/8/15 harvests · Full Report ×5 · yield club.
- **Problem Solver**: 1/10/25/50/100 accepts · 10/25 distinct members helped.
- **Researcher**: first sourced strain · 10 strains · 500 readings logged.
- **Experimenter**: first/5/15 experiments · first WORKED · Replicated.
- **Community**: first thread · welcomed 10 newcomers · contest
  entrant/finalist/winner · 10 curations.
- **Explorer**: Full Spectrum · used every unlock category once ·
  completed all 3 journey arcs.
- **Mentor**: dedicated chain (Knowledge-path stories).
- **Seasonal/Hidden**: Four Twenty, Comeback, Deep Roots, Secret Stash.
- **Rare/Prestige**: Evergreen (365 streak), Elder standing, Master
  Cultivator.
- **Legacy**: archived V1 badges (collapsed "Legacy collection").

No income, no progress-bar bait — the *value* is the unlocks and the
story on the profile.

---

## 12. Grower Journey dashboard

`/progress` leads with **"what should I do next"**:

1. **Hero**: rank + grow level + "Next unlock: *X* at *Rank Y* — Z XP
   away" (always something close).
2. **Next Action**: stale diary → open quest → near path level → near
   achievement → unanswered question in your domain.
3. **Active grow card**: journey stage, next requirement, coverage
   score, missing-metric hints (unlocked-gated views degrade to a tease).
4. **Mastery bars** — your build at a glance + diversity floor status
   for the next rank.
5. **Quest board** — dailies + weekly arc + streak (with its non-XP
   rewards labeled honestly).
6. **Achievement chains** — nearest rung per family.
7. **Standing panel** — visibly separate; shows what trust gates next.

Unlock celebrations follow the contract: *what opened · why you earned
it · one tap to use it.*

---

## 13. TerpBot integration

- **Progression → data → bot** (the flywheel): Records XP pays for
  exactly the fields `terpbot-intel-capability` consumes; quests can
  target a grow's `unknown` evidence without exposing mechanism.
- **Bot features as unlocks** (§8): watch rules (Preflower),
  longitudinal analysis (Flowering), experiment analysis (Harvested),
  cockpit intel (Cured+) — gated via unlock flags, never raw numbers.
- **Bot is never a progression input** and never a fake character; its
  own achievements stay in the isolated bot registry.
- Commands updated: `/rank /masteries /quests /achievements /next`;
  announcements for rank-up, path-up, unlock (once-ever markers).
- **Never paywalled basics**: Q&A, /grow, /streak, symptom help stay
  free at every rank — intelligence deepens with progression, never
  disappears behind it.

---

## 14. Example player journeys

Weekly rates use §6 values; arc payouts counted where they land.

### A. New Grower — first 30 days (~90/wk burst, ~40 after)

- Wk1: onboarding +15, First Grow arc +50 (steps 1–2), diary +15,
  3 update-days ~30, quests ~15 → **~125 XP** → Germinated day 1,
  Seedling day 4.
- Wk2–4: ~40/wk (2 update-days, some forum) + arc steps → ~**320** by
  day 30 → Rooted wk3, Vegged ~wk9.
- Mastery: Cultivation M2, Records M1, Community M1 — a Cultivator
  build emerging.
- Motivation: comparison panel just opened; Rooted's templates 100 XP
  away; First Grow arc step 3 visible.

### B. Casual Grower — 3 months (~35/wk + one grow arc ~350)

- ~800 total → Rooted, closing on Vegged (900). Cultivation M3,
  Records M1.
- Motivation: Vegged env analytics ~100 XP away; his first harvest arc
  payout (+165 across harvest/complete/season) is the next big dopamine
  hit — the grow itself *is* the grind.

### C. Dedicated Grower — 6 months (~120/wk avg)

- ~2,800–3,200 → **Preflower→Flowering**. Cultivation M4, Records M3,
  Community M2 (diversity floor for Flowering cleared naturally).
- Holds: comparisons (all three ladder steps arriving), env analytics,
  templates, exports, watch rules, longitudinal analysis landing right
  at month ~7.
- Motivation: Harvested's Cockpit at ~14 months is the visible
  mid-term goal; Records M4 → compound watch rules close.

### D. Expert Contributor — 1 year (~200/wk: grows + 2–3 accepts/wk + guides)

- ~9,000–10,500 → **Harvested** (~9 mo), pushing toward Cured.
  Knowledge M5+, Cultivation M4, Records M3, Community M3.
- Unlocks: full analytics + cockpit + advanced watch + mentoring +
  guide authoring; standing ~Respected (accepts + contest + referrals)
  → Progression Verified, Grow Room-eligible at Cultivator.
- Motivation: Cured historical trends; Master Cultivator ~2.2 years —
  the visible prestige target.

### E. Long-Term Veteran — 2+ years (~80/wk sustained)

- ~8,000–17,000 depending on intensity → Harvested → Cultivator.
- Holds the rare rooms, the evidence views, the early-access flag —
  visibly scarce status because the apex is *designed* to be slow
  (Master Cultivator ~7+ years at veteran pace — a true long-tail
  goal, not a checkbox).

### F. Abuse-Prone User — "efficient" farming attempt

- 20 min-length posts/day → caps at 20 XP/day Community, simhash cuts
  most → ~50–60/wk ceiling; weekly soft cap halves further.
- Like ring → **0 XP, 0 standing** (likes pay nothing, period) +
  reciprocal flag.
- Sock accepts → grantor floor halves standing; reciprocal-accept
  detector + staff reversal (final) claws it all.
- Diary filler → meaningful-update/simhash reject → ~0.
- **Effective ~35/wk while flagged** — stalls mid-Vegged at best, eats
  reversals, and cannot touch standing-gated anything. Legitimate
  players lap him ~3–4×.

---

## 15. Economic invariants (formal)

1. **Quality beats quantity** — a band-3 update pays ~3× a filler one;
   near-duplicates pay nothing extra.
2. **No single activity dominates** — source caps + per-mastery soft
   caps + diversity floors.
3. **Social approval cannot manufacture XP or standing** — likes,
   follows, reactions write no events.
4. **Low-effort repetition asymptotes to ~0** — meaningful-update floor,
   simhash withholding, soft caps.
5. **Functional > cosmetic** — every rank has ≥1 functional unlock;
   cosmetics are incidental (D5).
6. **Every rank has a purpose** — §5.5 holds for all 13.
7. **Early is fast, prestige is slow** — §5.3's pacing table.
8. **Standing cannot be bought or ground** — peer/staff-gated sources
   only, weekly ceiling, grantor floors.
9. **Safety-critical functions never gated** — §8 baseline.
10. **Every award is auditable** — keyed, sourced, meta'd ledger rows.
11. **Every reward path reconciles** — sweeps re-verify quests/
    challenges/referrals; drift invariants on all three balances.
12. **Invalid progression is revocable** — reversal/reinstate/final +
    unlock freeze + standing negatives.
13. **Useful behavior > screen time** — nothing pays for presence.
14. **Failure can be worth more than silence** — documented failures
    pay Experimentation; the economy never rewards pretending.

---

## 16. Dangerous rewards — what we will NOT do

- ❌ Moderation/staff powers from XP or standing alone.
- ❌ Rate-limit *removal* — boosts are bounded multipliers.
- ❌ Notification reach, broadcast, mass-mention rights.
- ❌ XP for volume, presence, or reactions.
- ❌ Verification purely from grinding (standing+age+flags required).
- ❌ Unlocks exposing private data (own-data or k-anonymized only).
- ❌ Purchased progression of any kind.

---

## 17. Database architecture (unchanged from rev 1)

```prisma
model ProgressionEvent {
  id            String   @id @default(cuid())
  userId        String
  mastery       String?           // CULTIVATION|RECORDS|KNOWLEDGE|EXPERIMENTATION|COMMUNITY (null=SYSTEM)
  type          String            // award vocab (§6) | REVERSAL|REINSTATE|STAFF_ADJUSTMENT|LEGACY_STANDING|MILESTONE|STANDING_RECOVERY|UNLOCK_FREEZE
  xp            Int      @default(0)
  standing      Int      @default(0)
  reason        String
  key           String?  @unique
  sourceType    String?
  sourceId      String?
  actorId       String?
  meta          Json?             // simhash, band, quest slug, quality detail
  reversedAt    DateTime?
  reversalOfId  String?
  reversalFinal Boolean  @default(false)
  createdAt     DateTime @default(now())
  @@index([userId, createdAt]) @@index([userId, mastery, createdAt])
  @@index([sourceType, sourceId]) @@index([actorId]) @@index([key])
}

model MasteryProgress { userId, mastery, xp Int; @@id([userId, mastery]) }
model Achievement { id, key @unique, family, name, description, icon, rarity, spec Json?, hidden Boolean }
model UserAchievement { userId, achievementId, earnedAt, pinned; @@unique([userId, achievementId]) }
model PendingXpReversal { /* PendingReversal field-for-field */ }
```

`Profile`: +`xp`, +`standing`, +`legacyVerified`, +`unlockFrozen`
(unlock freeze flag); `reputation` retained frozen. Three drift
invariants: `xp==SUM(xp)`, `standing==SUM(standing)`,
`MasteryProgress.xp==SUM(xp by mastery)`. Old `ReputationEvent`,
`Badge`, `UserBadge` retained read-only.

---

## 18–21. API / UI / UX / Tests (architecture unchanged)

- API: `awardProgression(userId, mastery, type, {xp, standing}, reason,
  opts)` port of `awardReputation`; `/api/progression` v2 shape;
  `/api/users/[username]/progression` public-safe; leaderboards per
  path; `hasUnlock(userId, key)` as the single gate helper.
- UI: `/progress` per §12; achievements in families + legacy collapse;
  rank chip + mastery pips + standing chip — never visually confused.
- UX contract: next-action first; unlock says what/why/where; caps
  stated honestly; XP and standing never share iconography.
- Tests: extend `reputation-tests.mts`, `rewards3`, `check-drift`,
  `self-service`, `trust-safety`, `runtime-verify`, `terpbot-*` —
  **no new suite** (per the consolidation).

---

## 22. Performance

- Award path: 1 subject read + 1 tx (event + 2 balance increments + 1
  mastery upsert) — same cost class as today.
- Soft-cap check = `count` on `(userId, mastery, createdAt)` — indexed.
- `/api/progression`: ~10 indexed queries; mastery reads hit 5 rows.
- Leaderboards/mastery boards: groupBy on indexed `(type, createdAt)`.
- Ledger growth ≈ today's rate; archival unnecessary at launch.

---

## 23. Implementation phases (unchanged skeleton)

0. Schema+config → 1. Engine (dual-write flag) → 2. Economy live →
3. Ranks/masteries/UI → 4. ◆ unlock builds (export, alerts, cockpit,
challenges, mentoring, templates — the heavy phase) → 5. TerpBot →
6. Cutover (standing seed, legacy archive, verified grandfathering,
flag flip, freeze) → 7. Cleanup + 2-week drift/velocity monitoring.

---

## 24. Second-order review — contradictions found & resolved

| Risk found | Resolution |
|---|---|
| **Likes paid standing in rev 1** — still a farmable social vector | Now pays **nothing to either axis** (§6.6, §9.1). Standing sources are strictly judgment-gated. Weekly board redefined: net member-driven **XP** in ISO week (like income was on the old board). |
| **Path XP could become "5 more grinds"** | Paths don't gate basic tools — only specialist tools and prestige floors. A specialist can ignore 4 paths and still get their niche unlocks (§7.3). |
| **Weekly soft caps might punish dedicated growers** | 200/path/week ≈ 33/day in one path — a dedicated grower spreading across 2–3 paths effectively never hits it; it's calibrated to farm-patterns, not humans (§7.4). |
| **Too many unlock requirements = confusion** | Each unlock has ONE primary gate (rank or path), with standing only on community-surface items. UI shows one progress bar per unlock (§12). |
| **TerpBot could feel paywalled** | All Q&A, /grow, /streak, and safety help are baseline; unlocks are strictly *deeper* analysis layers (§13). |
| **Achievements as shadow-XP** | They pay 0 XP by rule; their unlocks are utility, and the families are bounded at ~40 with no volume rungs (§11). |
| **Standing could drift grindable** (reports+5 farmable?) | Report-upheld requires a real staff action — spam reports get dismissed and can cost the *reporter* nothing-positive; weekly ceiling + detectors cover the rest. |
| **Early unlocks weak** | Added comparison panel at Seedling (day ~4) and made Germinated instant-useful; every rank through Vegged ships a real tool (§8.1–8.2). |
| **Quest "run a comparison" circular** | Only offered when unlocked — capability-gated quest pool (§10.1). |
| **Cockpit unlock too late** | Moved to Harvested (~mid-late), the flagship reward justifying the long middle; Cured adds depth on top. |
| **Prestige ranks hollow** | Master Cultivator unlocks: Vault, research aggregates, early access, apex identity — genuinely scarce and non-cosmetic (§8.4). |
| **Harvested threshold lowered (8.5k→7.5k)** | Intentional: pulls the flagship Cockpit unlock into mid-late game (~14 mo dedicated) and shortens the longest mid gap; sub-levels keep feedback steady inside Ripening→Harvested. |
| **Failure bounty could be farmed** (trivial/fabricated failures) | Bonus reduced to +8 and gated by §6.4a: ≥24h active age, linked evidence/hypothesis, conclusion, per-author uniqueness, 2/week cooldown — it pays for *documentation value*, never for failing. |
| **Two-tier simhash could punish recurring logs** | Resolved: simhash runs on prose only; changed structured data preserves bonuses; band-1 base always survives once/day; ≥95% required for full withholding (§6.7). |
| **Standing weekly cap + seeded legacy balance conflict?** | None — the 40/week ceiling bounds *new income only*; the `LEGACY_STANDING` seed is a one-time balance, exempt by definition. |
| **Watch rules as pure rank unlock = non-documenters maxing TerpBot** | Laddered (§8.3): basic at Preflower (rank), advanced at Harvested + Records M3, compound rules at Records M4 — TerpBot depth tracks the member's own data quality. |
| **Three-layer gating adds prerequisite complexity** | Confined: most unlocks are Layer A; Layer B only where the tool's value scales with the member's own data (analytics/TerpBot); Layer C only where other members are affected. Each unlock shows one progress bar in UI. |

---

## 25. Final decisions — D1–D7 resolved

| # | Decision | Rationale | Migration | Abuse/security | UX |
|---|---|---|---|---|---|
| **D1** | **Seed standing** from old ledger trust-sum (one `LEGACY_STANDING` row per member) | Trust is safety capital, not game progression — resetting it would strip earned link/verified privileges and punish legit members for a redesign they didn't cause | Read-only seed job; old ledger untouched | Same detectors govern new standing; seeded value is auditable via the marker row | Members keep their standing name + gates; only XP visibly resets |
| **D2** | **Grandfather verified → `legacyVerified`** | Revoking earned status is a promise-break; but it can't be a permanent free pass | `Profile.legacyVerified` flag; role preserved | Revocable for ordinary trust/safety reasons like any standing-gated status | "Verified (early member)" tooltip; identical privileges, honest provenance |
| **D3** | **Hard-reset XP to 0 for everyone** | Per brief — clean economy, no legacy-inflation carryover; everyone starts the new game together | New `Profile.xp` starts at 0; no backfill | Eliminates inherited unearned progression | Communicated as "Season 2 — everyone starts as a Seed"; old badge showcase archived, not deleted |
| **D4** | **Freeze `ReputationEvent` read-only** | It's the audit trail; destroying it buys nothing | Table retained, writes stop at flag-flip | Audit/history preserved for disputes | "Legacy collection" section on /achievements |
| **D5** | **Cosmetics are incidental** — keep the registries, re-key unlocks to rank; no new cosmetic-driven design | The brief demands functional-first rewards; cosmetics remain seasoning | Equipped cosmetics re-validated at cutover; pre-V2 owners get "Legacy Vanity" keepsakes | Equip gates unchanged mechanically | Identity continuity without power |
| **D6** | **`DAILY_LOGIN` = 0 XP permanently** | Login faucets reward presence, not value; streaks survive as habit mechanics with utility rewards (§10.4) | DAILY_LOGIN type removed from the new economy | Kills the cheapest farm vector | Streak UI shows utility rewards honestly — no hidden XP |
| **D7** | **Achievements pay 0 XP** | Achievements unlock utility/identity — giving XP would make them shadow-income and re-create badge-bonus inflation | BADGE_BONUS type retired | No double-dipping between story and economy | Achievement cards show *what they unlock*, which is a stronger pull |

---

# Design Revision Summary

## Changed (material revisions from rev 1)

- **§5 rebuilt around pacing, not defense**: thresholds retuned to
  **Germinated 60 → Rooted 420 → Vegged 900 → Flowering 4,000 →
  Harvested 7,500 → Cured 12,000 → Cultivator 17,000 →
  Master Cultivator 23,000** — the change is pacing, not inflation:
  Germinated day 1, Rooted ~wk 3, Vegged ~wk 7 dedicated, Flowering
  ~7 mo, Harvested ~14 mo. Added XP-per-gap column, per-persona
  calendar table (A–E), and **rank diversity floors** for prestige
  ranks.
- **§6 is now a complete economy**: every source quantified across all
  five paths, dual-path events defined (substantive answers pay
  Community+Knowledge), documented-failure XP added (failure > silence),
  explicit zero-XP table, deterministic **quality bands (0–3)**, simhash
  repetition rule, per-mastery weekly soft caps.
- **§7 mastery deepened**: 10-level paths with build titles (specialist/
  hybrid/all-rounder), path-gated specialist tools, alternate unlock
  routes (rank OR path).
- **§8 unlock catalog tripled**: categorized (F/Cv/Cp/A/T/L/Cs/P),
  baseline-never-gated list, per-unlock req columns incl. path &
  standing, ★/◆ status, abuse/privacy review.
- **§9 standing hardened**: likes removed from *both* axes; all sources
  are judgment-gated; weekly ceiling, grantor floors, negative signals,
  recovery-after-90-clean-days; Legacy vs Progression Verified fully
  specified (§9.6).
- **§10 streaks → utility rewards** (temp quest slots, bonus quests,
  cosmetics) — never XP.
- **§11 achievements unlock utility**: First Harvest→Grow Summary,
  Triple Harvest→Harvest Comparison, Greenlight→Mentor tools, etc.
- **§14 expanded to six personas** with numbers.
- **§15 formal economic invariants** (14 rules).
- **§24 second-order review**: contradictions identified and resolved
  (notably: likes fully removed, cockpit moved earlier, soft-cap
  calibration verified against honest users).

## Retained (intentionally unchanged)

- The audit (§1) and the survival categorization (§2).
- The append-only ledger, outbox, reversals, reconciles, drift checks,
  detectors, keyed idempotency, derived-progress philosophy, feature
  flags — the strong spine.
- DB/API/test/performance architecture (§17–22) — the economy changed,
  not the plumbing.
- Two-axis separation, baseline-never-gated rule, no-LLM rule, privacy
  rules, no-pay rule.
- 13-rank grow-cycle vocabulary and sub-level mechanism (retuned, not
  redesigned).

## Rejected

- **Likes → standing (rev 1)**: still a manufactured-approval vector.
  Rejected — likes pay nothing, period.
- **Standing decay for inactivity**: punishes hiatuses, adds complexity
  without catching abuse. Rejected — recovery mechanic instead.
- **Per-source weekly decay curve**: redundant with per-mastery soft
  caps; two decay systems = confusion. Rejected — caps + floors suffice.
- **XP multiplier retention for verified**: pure income inflation.
  Rejected (was already flagged; now decided).
- **Achievements paying small XP**: shadow-income. Rejected.
- **Paying XP for running comparisons/viewing analytics**: view-click
  farming. Rejected — only *documented* findings pay.
- **Gating diary inputs (structured fields) by rank**: punishes exactly
  the behavior we want. Rejected — gate *analytics on the data*, never
  the data entry.
- **Hard-resetting standing with XP** (D1 alternative): would strip
  legitimately-earned trust. Rejected.

## Final D1–D7

| D1 | Seed standing from historical trust-sum — **YES** |
| D2 | Grandfather verified as `legacyVerified`, revocable for T&S — **YES** |
| D3 | Reset all XP to 0 — **YES** |
| D4 | Freeze `ReputationEvent` read-only — **YES** |
| D5 | Cosmetics incidental; re-keyed to ranks; legacy keepsakes — **YES** |
| D6 | `DAILY_LOGIN` = 0 XP permanently; streaks pay utility — **YES** |
| D7 | Achievements = 0 XP; unlock utility/identity — **YES** |

## Implementation implications (for the eventual build phase)

- New `ProgressionEvent` ledger (dual xp/standing + mastery + meta) and
  `MasteryProgress`, `Achievement`/`UserAchievement`,
  `PendingXpReversal`; `Profile` gains `xp`, `standing`,
  `legacyVerified`, `unlockFrozen`.
- Port `applyReputationAward`/`awardReputation`/reversal family to the
  new shape; add band/simhash evaluation and soft-cap counting inside
  the award transaction; retarget ~15 callsites.
- Config module: XP table, 13 ranks + sub-levels, mastery thresholds,
  diversity floors, unlock registry, quality bands.
- Rebuild quest/challenge/arcs definitions (same engine); redefine
  weekly board on member-driven XP.
- Build ◆ features in phase order: exports, templates, advanced
  filters, reminders, env/harvest analytics, watch rules, cockpit,
  challenges, guide authoring, mentoring, historical trends, research
  aggregates.
- Gate ★ items via `hasUnlock` (comparisons, longitudinal analysis,
  rooms, rate boosts, image/tag slots, quest slots).
- Migration: standing seed, `legacyVerified` flag, legacy badge archive,
  cosmetics revalidation + keepsakes, `progression_v2` flag, outbox
  drain before freeze.
- Tests extend existing suites only; 3 drift invariants added to
  `check-drift`.

## Remaining risks

- **Economy tuning is still paper math** — the persona numbers need a
  beta-cohort sanity pass; thresholds live in config so retuning is
  cheap.
- **Casual-grower lane** (D6-adjacent open question from rev 1 resolved
  implicitly): one grow/season ≈ Vegged at ~5 months feels right; the
  long-tail (Harvested ~3.5yr) may still under-reward passive members —
  acceptable if the product wants engagement, flag for review.
- **Soft-cap calibration** — 250/path/week is set so honest users never
  feel it; verify against real usage telemetry post-launch.
- **Casual lane rechecked after retune**: with arcs a casual member now
  reaches Harvested ~2.5 yr — acceptable; still flagged for review if
  engagement data says otherwise.
- **Grantor-floor half-pay on standing** could confuse legit helpers
  answering low-standing newcomers' OPs — monitor for perceived
  unfairness; the +12 newcomer bonus partially compensates.
- **◆ build cost is the schedule risk** — Phase 4 is big; the cheap
  ★ gates should ship first so members feel the system before the
  flagship unlocks land.
- **Simhash cost** — per-award comparison vs 30d of an author's content
  is bounded but real; confirm performance at scale before launch or
  demote to a reconcile-time check.

---

# Design-lock addendum (rev 3 — final tuning)

Final tuning decisions applied:

1. Harvested 8,500 → **7,500**; Master Cultivator 26,000 → **23,000**;
   all persona timelines recomputed (§5.3, §14). Curve shape preserved.
2. Documented-failure bonus +15 → **+8**, gated by §6.4a structured
   requirements (24h active age, linked evidence/hypothesis, conclusion,
   per-author uniqueness, 2/week cooldown). Pays for documentation, not
   failure.
3. Simhash → **three-tier**: ≥95% withhold, 85–94% reduce/context-check,
   <85% clean; prose-only hashing + structured-data-change exception so
   recurring honest logs are never penalized; all withholds audited.
4. Per-mastery weekly soft cap 200 → **250** full rate (50% to 500,
   25% beyond) — farm wall, not a productivity ceiling.
5. **Comparison ladder**: Seedling basic → Vegged advanced env
   (Records M2) → Flowering longitudinal/multi-grow (Records M2).
6. **TerpBot watch ladder**: Preflower basic (3 rules) → Harvested
   advanced (10 rules, Records M3) → compound multi-condition
   (Records M4). Safety alerts ungated.
7. **Grower Cockpit stays at Harvested** — designated flagship; §8.4a
   explains why it changes how a member uses the product.
8. **Three-layer unlock model** formalized: A = rank, B = rank+path,
   C = rank+path+standing; every unlock tagged.
9. **Standing weekly cap 60 → 40**; per-grantor diminishing +
   30-lifetime cap; reciprocal → 0; cluster discount; per-source-type
   20/week ceilings; staff grants exempt. Likes remain 0/0.
10. §5.5 why-care test expanded to full per-rank breakdown — all 13 pass.
11. §8.6 unlock-density audit added — no dead zones; Mastery-era gaps
    intentionally sparse and padded by path/achievement/standing motion.
12–14. Achievements stay 0 XP; badge philosophy kept; `DAILY_LOGIN`
    stays 0 XP with utility streak rewards.

## Design-lock validation (invariants verified)

- Quality beats quantity ✓ (bands, structured bonuses, simhash)
- Forum spam does not beat grow records ✓ (Community is lowest-value
  path; Cultivation/Records arcs dominate)
- Social approval creates no XP ✓ — **and no standing** (likes write
  nothing, both axes)
- Login = 0 XP ✓ · Achievements = 0 XP ✓
- Failure bonus requires documentation value ✓ (§6.4a)
- Duplicate farming deterministically constrained ✓ (§6.7)
- No single activity unlocks everything ✓ (caps + diversity floors +
  layer-B/C gates)
- Functional ≫ cosmetic rewards ✓ (every rank functional; cosmetics
  incidental)
- Paths have distinct identities & implications ✓ (§7, builds)
- Standing: separate, judgment-gated, cap-controlled, cluster/reciprocity
  hardened, auditable, not a second currency ✓ (§9)
- Unlocks layered A/B/C; safety-critical never gated ✓ (§8)
- Old ledger auditable; XP resets; standing seed defined; legacy
  verification defined ✓ (§9.6, §16/D)

**Status: DESIGN LOCKED.** Companion implementation plan:
`docs/progression-v2-implementation-plan.md`.
