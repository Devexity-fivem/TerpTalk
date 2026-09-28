# TerpTalk Roadmap Reconciliation — Current-Head Pass

**Type:** read-only reconciliation. No code, schema, migrations, seeds, APIs, UI, TerpBot, cron, or data touched. Only this document was created; a short addendum was appended to the audit file.
**Inputs:** `docs/audit/terptalk-vs-growdiaries-audit.md` (the audit), `docs/audit/growdiaries-evidence.md` (the evidence file), verified against current source.
**Date:** 2026-09-27.

---

## PART 1 — Current-head reconciliation

| Item | State |
|---|---|
| Branch | `progression-v2` |
| HEAD | `8b6d609` (`progression-v2: replace cosmetics with Garden Perks, plain-language copy`) |
| origin/master | `4611163` (`feat(moderation): staff thread move + delete controls`) |
| Branch vs master | 7 commits ahead, no upstream tracking on `progression-v2` |
| Working tree | Clean except untracked `docs/audit/` |
| Progression V2 commits | `7952da2` design lock → `f4387e1` schema → `4f835c2` migration → `5663824` award engine → `302c1e4` callsite rewiring → `b22ad24` Phase 3.6 stabilization → `8b6d609` Garden Perks |
| Schema/migrations | **66** migrations on disk, all applied to the Neon dev branch (`ep-old-breeze-au1f8sl5`); `prisma migrate status` clean; `db-guard.mjs` hard-refuses prod (`ep-billowing-dew`) |

**Headline finding: the audit baseline IS current HEAD.** `git log 8b6d609..HEAD` is empty — no progression work has landed since the audit snapshot. The premise that "the current progression work has since advanced beyond that snapshot" is not borne out by the repository. Nothing in the audit is newly resolved by later code.

However, re-verifying every claim against current source produced a **sharper** picture than the audit's. The audit said "many unlocks are registered but not enforced/built." The actual state has four distinct failure modes, and one of them is worse than reported:

| Audit finding | Verdict now |
|---|---|
| ~45 unlocks registered; only a subset enforced | **STILL TRUE, understated.** See Part 4: enforcement is fine where it exists, but 6 unlocks are *vacuous* (feature already free for everyone), 24 are registered-only, **13 XP event types have no award callsite at all**, the **EXPERIMENTATION mastery path earns zero XP** (dead path — M0 forever), and the **achievement engine is schema-only** (`userAchievement.create` has zero writers). |
| Strain catalog exceeds sitemap cap | **STILL TRUE** — sitemap `take: 500` vs 658 strains; threads 1000, diaries/profiles/setups/tags 500, guides 200, single sitemap, no index/pagination. |
| No Brand/Product/Breeder/WatchRule/Reminder models | **STILL TRUE** — schema has `AffiliateProduct` (deals) and `ProductChange` (ops changelog) only. |
| Questions parity needs stage facet + diary link | **STILL TRUE** — `Thread` has `wizardResultId` + tags but no `stage`/`diaryId`; `/questions` has unanswered/solved tabs. Diary↔thread link exists only via `DiaryDiscussion` (the diary's own thread). |
| Harvest report thin (no per-plant, graph, reviews) | **STILL TRUE** — `DiaryUpdate` has 17 metrics incl. night/substrate temp, CO₂, PPFD, photoperiod, runoff pH/EC, lamp distance; harvest is yield+rating+difficulty+notes+lessons. No `potSize` per update either. |
| TerpBot deterministic stack, BOT_ASSIST, least-privilege | **STILL TRUE** — verified intact; snapshot → decisions pipeline; no award/moderation authority. |
| Mobile: PWA only, cookie auth, ~300KB data-URI uploads, no push | **STILL TRUE.** |
| Cosmetics fully removed | **PARTIALLY RESOLVED — with two residues** (new finding): (a) **rank nameplates** live on — `RANK_DISPLAY[].nameplate` (`tt-nameplate-leaf/bloom/master/grand/gold`) styles usernames in `chat-room.tsx`, `forum/thread/[slug]/page.tsx`, `content-card.tsx`. Rank-derived, not equippable, not advertised as a reward — but it is cosmetic styling and deserves an explicit keep/drop decision. (b) Legacy `reputation-config.ts` `benefit` strings still advertise removed cosmetics ("Photon Pulse frame", "Northern Lights frame", "Deity Glow theme"…) — dead code, not rendered, cleanup only. |
| Unenforced-but-promised unlocks shown to members | **STILL TRUE and user-facing**: `/api/progression` serves `unlockStates` + `RANK_DISPLAY.benefit` strings; `/progress` renders "Next unlock: X" and the full roadmap. Members are shown promises that do not exist (Part 4 lists each). |

**Status labels applied:** STILL TRUE / PARTIALLY RESOLVED / ALREADY RESOLVED (none — no code moved) / OBSOLETE (none) / STILL PLANNED BUT NOT IMPLEMENTED (the 24 registered-only unlocks + dead pipelines).

---

## PART 2 — Competitor audit preservation

`growdiaries-evidence.md` stands unchanged: OBSERVED/DOCUMENTED/INFERRED/UNKNOWN classifications are intact, observation date 2026-09-27. No competitor claim is upgraded. The audit file received only a short addendum noting: baseline==HEAD, the corrected comparison-viewer fact (comparison rows render to **all diary viewers**, not just the owner — `diaries/[id]/page.tsx` line ~926 has no `isOwner` gate), migration count 65→66, the dead-pipeline findings, and the nameplate residue. No competitor observation was rewritten.

---

## PART 3 — TerpTalk position at current HEAD (delta vs audit)

| Domain | Current position | Delta vs audit |
|---|---|---|
| Community | 22 categories, threads, polls, accepted answers, follows, reactions, chat w/ 60+ commands, DMs, moderation stack | unchanged |
| Grow diaries | Free-cadence updates, 17 metrics/update, derived weeks, PUBLIC/UNLISTED/PRIVATE, discussion thread per diary | unchanged |
| Structured grow data | Richest per-update metric set vs GD; **no pot size per update** | refined |
| Harvest | yield/unit, rating, difficulty, notes, lessons → strain stats + yield leaderboard | unchanged |
| Questions/diagnosis | `/questions` (unanswered/solved tabs, tags), 11-group symptom tags, Plant Doctor wizard → tagged thread, accepted answers, TerpBot `/diagnose` | unchanged |
| Strains | 658, breeder as **string**, variants/aliases absent, min-sample grow stats | unchanged |
| Breeders | grouping pages from strings only | unchanged |
| Nutrients/equipment | free text everywhere | unchanged |
| TerpBot | full deterministic stack + BOT_ASSIST + owner-scope intel | unchanged |
| Progression | dual ledger live, keyed awards, reversals; **but** 13 dead event types, dead EXPERIMENTATION path, schema-only achievements | **worse than reported** |
| Reputation/Standing | enforced gates: links, polls, chat rooms, slowmode, rate limits, images, tags, showcase | unchanged |
| Achievements/Badges | achievements schema-only, zero writers; legacy badges archived + showcase slots enforced | unchanged |
| Search/discovery | 7-entity unified search, saved searches (cap 50 **for all**), discover/feed | refined (cap is universal, not tiered) |
| SEO | slugs, JSON-LD on diaries/threads/guides, breadcrumbs, capped sitemap | unchanged |
| Mobile/PWA | manifest + SW static caching; no push/token API/signed uploads | unchanged |
| Privacy/pseudonymity | no-email accounts, recovery phrase, visibility tiers, block-aware reads | unchanged |
| Moderation/trust | reports, queue, audits, abuse flags, reversals | unchanged |
| Exports | `/api/profile/export` — **all members, all data** | refined (not rank-gated; "export-tools" unlock vacuous) |
| Analytics | TerpBot owner intel + public strain stats; no member analytics UI | unchanged |
| Notifications | grouped in-app + Pusher + prefs; no push | unchanged |
| Chat | rooms incl. gated Grow Room/Vault behind `grow_room_enabled` flag | unchanged |
| Contests | weekly Budshot + monthly diary, community votes, XP-gated voters | unchanged |
| Monetization | affiliate deals + `minRank`/`publicAt` gating + click tracking | unchanged |

---

## PART 4 — The product-integrity gap, current code

45 registry unlocks, classified by actual state (not registry intent):

| # | Unlock | Registry gate | Enforcement mechanism | State | What remains |
|---|---|---|---|---|---|
| 1 | quest-slot-4 | Rooted | `hasUnlock` in `quests.ts` | ✅ WORKING | — |
| 2 | quest-slot-5 | Cultivator | same | ✅ WORKING | — |
| 3 | pinned-harvest | Harvested / streak 60 | `hasUnlock` in `PATCH /api/profile` + picker + `/u/[u]` render | ✅ WORKING | — |
| 4 | grower-spotlight | Cured / streak 100 | `spotlight.ts` deterministic weekly pick + home card | ✅ WORKING | — |
| 5 | grow-room | Cultivator + standing 100 | `chat-access.ts` `requiredXp`+`roomStandingReq`+`grow_room_enabled` flag | ✅ WORKING | room must exist in DB |
| 6 | the-vault | Master Cultivator + standing 300 | same | ✅ WORKING | same |
| 7 | early-access | Master Cultivator | `hasUnlock` on `/deals`, `/go/[slug]`, `canSeeDeal(publicAt)` | ✅ WORKING (deals only) | "try new features" half unbuilt (no feature-flag consumers) |
| 8 | members-deals | Rooted | `AffiliateProduct.minRank` + `canSeeDeal` (not the unlock ID) | ✅ WORKING via parallel mechanism | effect is data-dependent: needs ≥1 product tagged `minRank` |
| 9 | top-shelf-deals | Cultivator | same | ✅ same caveat | same |
| 10 | rate-1.5 | Harvested | `progressionRateLimit` in chat/posts/threads | ✅ WORKING (perk, not ID) | — |
| 11 | rate-2 | Cured | same + `maxThreadTags` 7 in threads route | ✅ WORKING | — |
| 12 | images-6 | Flowering | `imagesPerPost` in posts route | ✅ WORKING | — |
| 13 | images-8 | Harvested | same | ✅ WORKING | — |
| 14 | images-10 | Cultivator | same | ✅ WORKING | — |
| 15 | streak-dashboard | Germinated | none — grow summaries + streak shown to all on /progress, member home, profile | ⚠ VACUOUS | decide: gate something or rewrite blurb |
| 16 | saved-searches-3 | Germinated | none — cap is **50 for everyone** | ⚠ VACUOUS | tier the cap or remove |
| 17 | saved-searches-10 | Trained | same | ⚠ VACUOUS | same |
| 18 | comparison-basic | Seedling | none — `buildGrowComparison` renders to **all diary viewers** | ⚠ VACUOUS | intended product is "saved comparison slots" per design §8 — build or de-promise |
| 19 | grows-6 | Vegged | none — **no active-grow cap exists** | ⚠ VACUOUS | introduce a real cap tier or remove |
| 20 | export-tools | Trained | none — `/api/profile/export` open to all | ⚠ VACUOUS | reframe as richer export or remove |
| 21 | advanced-filters | Trained | none — every strain/diary filter is public | ⚠ VACUOUS | add gated facet(s) or remove |
| 22 | grow-templates | Rooted | none — no template model/UI | ❌ NOT BUILT | build or de-promise |
| 23 | comparison-slot-2 | Seedling | none — single on-page panel only | ❌ NOT BUILT | needs comparison entity/slots |
| 24 | saved-views | Rooted | none | ❌ NOT BUILT | |
| 25 | env-analytics | Vegged / RECORDS M2 | none — no charts UI | ❌ NOT BUILT | data exists; UI only |
| 26 | comparison-env | Vegged / RECORDS M2 | none | ❌ NOT BUILT | |
| 27 | harvest-analytics | Vegged | none — harvest shelf only | ❌ NOT BUILT | |
| 28 | custom-reminders | Trained | none — no `Reminder` model | ❌ NOT BUILT | model + delivery |
| 29 | terpbot-watch-basic | Preflower | none — no `WatchRule` model/eval | ❌ NOT BUILT | model + snapshot-cron eval |
| 30 | longitudinal-analysis | Flowering / RECORDS M2 | partial — episodes/timeline/decisions exist internally; no user "whole-grow review" surface | ◐ PARTIAL | surface over existing pipeline |
| 31 | comparison-multi | Flowering / RECORDS M2 | none | ❌ NOT BUILT | |
| 32 | guide-authoring | Ripening / KNOWLEDGE M3 | guides POST is `forbidden("Staff only")`; `GUIDE_PUBLISHED` never awarded | ❌ NOT BUILT + dead event | member authoring + review queue |
| 33 | challenge-creation | Ripening / COMMUNITY M4 | none | ❌ NOT BUILT | |
| 34 | mentoring-tools | Ripening / KNOWLEDGE M3 / standing 100 / ach. greenlight | none — no routing/listing; `MENTOR_SESSION` dead; achievement route unreachable | ❌ NOT BUILT ×3 | |
| 35 | nutrient-schedules | RECORDS M3 | none — no Product model | ❌ NOT BUILT | depends on catalog (Part 7) |
| 36 | data-quality-insights | RECORDS M2 / ach. full-spectrum | partial — BOT_ASSIST `data-quality` trigger exists; no checklist surface; achievement route unreachable | ◐ PARTIAL | |
| 37 | experiment-templates | EXPERIMENTATION M2 | none — **and path earns 0 XP** | ❌ NOT BUILT + dead path | |
| 38 | grower-cockpit | Harvested | none — member-home is not the promised composed cockpit | ❌ NOT BUILT | |
| 39 | watch-advanced | Harvested / RECORDS M3 | none | ❌ NOT BUILT | needs basic first |
| 40 | watch-compound | RECORDS M4 | none | ❌ NOT BUILT | same |
| 41 | experiment-analysis | Harvested / EXPERIMENTATION M2 | none + dead path | ❌ NOT BUILT + dead path | |
| 42 | historical-trends | Cured / RECORDS M4 | none | ❌ NOT BUILT | needs ≥2 completed grows |
| 43 | dashboard-advanced | Cured | none — depends on cockpit | ❌ NOT BUILT | |
| 44 | community-evidence | Cultivator + standing 100 | none — no k-anon aggregates | ❌ NOT BUILT | |
| 45 | research-aggregates | Master Cultivator / RECORDS M4 | none | ❌ NOT BUILT | |

**Summary:** 14 working · 7 vacuous · 22 not built · 2 partial. Every "Next unlock" card and every `RANK_DISPLAY.benefit` string on `/progress` and `/reputation` currently advertises this mixture to real members.

### Dead pipelines beneath the registry (new findings)

| Pipeline | Evidence | Consequence |
|---|---|---|
| 13 XP event types never emitted | Zero literal callsites outside `progression-config.ts` for `METRIC_FIRST, COVERAGE_MILESTONE, PROBLEM_RESOLVED, EXPERIMENT_CREATED, HYPOTHESIS_DOC, EXPERIMENT_COMPLETED, FAILURE_DOCUMENTED, FOLLOWUPS_3, REPLICATION, MENTOR_SESSION, CONTEST_ENTRY, GUIDE_PUBLISHED, GUIDE_IMPROVEMENT` | These types sit in `MEMBER_DRIVEN_XP_TYPES` (weekly board allowlist) and the `/reputation` earn list advertises `GUIDE_PUBLISHED` to members |
| EXPERIMENTATION mastery path | Experiments feature is live (`/api/diaries/[id]/experiments`, chat `/experiment`, diary experiment rows) but **no awardProgression call** exists for it | The path is permanently M0 → `experiment-templates`, `experiment-analysis` unreachable; diversity floors lose a fifth earning route; UI shows a dead path |
| Achievement engine | `Achievement`/`UserAchievement` models exist; `userAchievement.create` has **zero** writers | `mentoring-tools` (greenlight) and `data-quality-insights` (full-spectrum) achievement routes unreachable |
| `STANDING_RECOVERY` | Evaluator exists, no writer | known/deferred (plan Phase 14 cron) |
| `REPORT_UPHELD`, `STAFF_GRANT` | in `STANDING_SOURCES`, no callsites | Phase 4/7 scope per plan — verify staff adjustment path covers standing before Phase 4 |

---

## PART 5 — Priority framework

- **P0 — Product integrity.** Anything members are shown that doesn't work: the 22 unbuilt + 2 partial unlocks advertised on `/progress`/`/reputation`; the 7 vacuous unlocks (promise worse than reality); the dead EXPERIMENTATION path; dead event types advertised in earn lists. For each, the correct resolution is **build it, gate the real thing, or remove the promise** — never leave a lie in the registry.
- **P1 — Core differentiation.** TerpBot watches, owner-grow intelligence surfaces, harvest depth, week views, experiments wired to XP, evidence aggregation. Strengthens what GD doesn't have.
- **P2 — Competitive parity.** Catalog identity, breeder entity, questions stage/diary link, sitemap scale, facet counts.
- **P3 — Growth/ecosystem.** Sponsored contests, claimed brand pages, product reviews, monetization surfaces, native apps.
- **WATCH.** GD Threads/Shorts, app adoption, contest economics.

Ordering principle: P0 is not "fix bugs" — it's "stop advertising rewards that don't exist." Some P0 items are trivially cheap (remove/retitle an unlock); others are real features (env charts). The mix is deliberate: integrity first, cheap removals before expensive builds.

---

## PART 6 — Differentiation guardrails

**Emulate from GD:** canonical product/brand identity behind nutrients & equipment; per-week diary presentation; richer harvest capture; strain variants by breeder; sponsored-contest *mechanism* (staff-judged, disclosed); sitemap-scale SEO.

**Deliberately NOT emulate:** like/grow-score/global-position economy; algorithmic short-post feed; vertical video; self-service brand posting; public-everything profiles; paid placement inside organic rankings.

**Do differently:** keep free-cadence journaling (weeks derived) — GD's weekly form forces cadence; keep standing/XP contribution-quality economy; keep pseudonymous no-email accounts; keep deterministic, cited TerpBot rather than generic help.

**Moat (what GD's model can't naturally produce):** owner-scope deterministic diagnostics with `/why` evidence trails; watch rules over a longitudinal snapshot; k-anonymous community evidence; question→diagnosis→experiment→outcome→strain-evidence closed loops; privacy-tiered grows.

---

## PART 7 — Catalog model (locked design, no implementation)

```
Brand          id, name, slug @unique, kind (NUTRIENT|EQUIPMENT|SEEDBANK|MIXED),
               country?, siteUrl?, imageUrl?, attribution?, verified (staff) — separate from Breeder
Breeder        id, name, slug @unique, country?, siteUrl?, imageUrl?, attribution?
Strain        +breederId? FK (keep `breeder` string as display fallback), +aliases String[]
StrainVariant  strainId, breederId — "Runtz by X" vs "by Y" aggregates separately, rolls up to Strain
Product        id, brandId, category (LIGHT|TENT|FAN|FILTER|METER|CONTROLLER|SUBSTRATE|NUTRIENT|OTHER),
               name, slug, specs Json?, feedChart Json? (NUTRIENT only), discontinued Boolean,
               aliases String[], status (CURATED|SUGGESTED|REJECTED), suggestedById?
DiaryProduct   diaryId, productId, role — replaces/augments free-text equipment fields
SetupProduct   setupId, productId, role
DiaryUpdateNutrient +productId? (productName stays; FK wins when present)
```

**Rules:**
- Free text never dies: every product reference degrades to `productName`/`lighting` text when no canonical link exists. Suggest-link UX mirrors `suggestStrainLink` (typeahead → link or keep text).
- **Curation: staff-curated + member-suggested/staff-approved** (GD's own rule — users can't create brands). Seed the catalog staff-side; members suggest via a small queue reusing report/feedback plumbing. No self-service brand accounts.
- `discontinued` keeps history readable without deleting rows; merge/dedupe is an admin tool.
- Product identity is **not** monetization. Affiliate linkage stays on `AffiliateProduct`; a `Product` may later gain a *disclosed* affiliate offer, never required.
- `ProductReview` (harvest-time, one per product per diary, eligibility = diary with ≥N updates + harvest) is a **separate later decision** — the catalog works without reviews.
- TerpBot consumes only validated catalog facts (feedChart, wattage/specs) through the knowledge registry — never product marketing text.

---

## PART 8 — Harvest Report V2 & Weekly Grow View (product behavior)

**Harvest Report V2** (each field's reason):
| Field | Product reason |
|---|---|
| `plantCount` | g/plant is the number growers compare; feeds yield leaderboard honestly |
| `wetWeight`/`dryWeight` | wet→dry loss is real grower data; keep `yieldAmount` = dry for compatibility |
| Stage durations | already derivable from timeline — display seed→harvest bar, no new capture |
| Multi-series graph | temp/RH/height/PPFD over the grow — the harvest climax members screenshot |
| Harvest observations | keep `lessons` JSON; add `smokeNotes`? — no, defer (verdict + notes suffice) |
| Next-grow transition | "Clone this grow" — prefill next diary (strain, medium, light, nutrients) |
| Comparison inputs | feeds comparison/historical-trends unlocks; per-plant weight enables g/plant |

**Weekly Grow View** (per derived week, on the diary page):
- Group header: week N, stage, day range; primary photo strip.
- Rollups: min/max/avg temp, RH, VPD (derive), PPFD, watering L total; nutrient lines (product + ml/L); training actions.
- Week-over-week deltas on 3–4 metrics (height Δ, temp Δ, RH Δ) — enough signal, not a dashboard.
- Reactions per week are **not** planned (reactions stay on the diary/discussion — week-level likes would import GD's like economy for zero knowledge gain).
- Facet counts (diaries by medium/light/technique) live on discovery, not the diary page.

---

## PART 9 — Questions / diagnosis (verified)

Current: `/questions` (unanswered/solved tabs, tag display), symptom tag taxonomy, wizard→thread, accepted answers, TerpBot `/diagnose`. Missing vs GD parity:
1. **Stage facet** — `Thread.stage` (enum reuse) + tag family; filter on /questions.
2. **Diary/week linkage** — optional `Thread.diaryId`/`diaryUpdateId` (SetNull), owner-consented, PUBLIC/UNLISTED only; "asked from week N" chip; gives answerers + TerpBot context.
3. **No-diary state** — implicit today (questions without links); just a filter chip once links exist.
That's all. **Do not create a separate Questions model** — thread + accepted answer + tags + wizard already is the entity; adding a parallel model would split search, moderation, and progression.

---

## PART 10 — SEO / discovery design

- **Sitemap index + per-entity chunks** (`generateSitemaps` or `sitemap/[id]`): threads, diaries (PUBLIC only — `publicDiaryWhere` already), strains, profiles (`rankableProfile()`), guides, setups, tags, breeders/products when they exist. Remove `take` caps inside chunks (or paginate at 45k/chunk — far beyond need).
- **JSON-LD:** strain pages get `Thing`/`Plant`-type schema + `AggregateRating` **only when** harvest-verdict min-sample is met; solved help threads get `QAPage`; existing diary `DiscussionForumPosting` kept.
- **Canonical URLs** already slugged; strain by slug (not id); breeder/product pages join the sitemap only after the catalog exists.
- **Never index:** UNLISTED/PRIVATE diaries, `/profile`, `/settings`, `/messages`, `/notifications`, `/feed`, deal redirect endpoints, opted-out/low-activity profiles (profile cap stays modest deliberately — thin member pages are low-value anyway).
- Symptom-tag landing pages (`/forum/tags/[slug]` in sitemap today): add 2–3 sentences of static copy + solved-first ordering — cheap acquisition surface.

---

## PART 11 — Mobile foundation (before any native client)

| Requirement | Design |
|---|---|
| Versioned API | `/api/v1/*` DTOs: auth, diaries, updates, notifications, feed, profile-public, terpbot-status — decoupled from page components |
| Auth | token pair (short access + rotating refresh) beside next-auth cookies; device-bound; revoke-all on password change/deletion |
| Uploads | signed Blob URLs + server re-encode (replace ~300KB data-URI path for camera photos) |
| Push | `PushSubscription(userId, platform, token, revokedAt)`; `notify()` fans out in-app + push; reuse per-type prefs + BOT_ASSIST caps |
| Deep links | path table `/d/[slug]`, `/t/[slug]`, `/u/[u]`; deferred link handling |
| Device security | per-device session listing/revocation in settings; SecurityEvent on new device |
| Compatibility | web stays on cookies; v1 responses additive-only; idempotency keys on update POST for retry |

**Build point:** after Phase 0 + the P0 integrity batch (an app that advertises nonexistent unlocks exports the lie). **PWA remains supported** — native adds push + camera + install, nothing else v1.

---

## PART 12 — Monetization surfaces (neutral evaluation)

| Surface | Trust/pseudo | Conflict risk | Moderation load | Manipulation risk | Legal | Verdict |
|---|---|---|---|---|---|---|
| Affiliate deals (exists) | high / ok | low — disclosed | low | low | FTC disclosure (present) | keep/extend to Product pages later |
| Sponsored contests (staff-judged) | high if disclosed | med — sponsor never touches XP/standing/rank | med (entries) | low w/ staff judging | prize-law varies by jurisdiction; terms + eligibility wording needed | **candidate, Phase 5** |
| Claimed brand pages | med — impersonation risk; staff verify | med — labeled entity page, no feed presence | med | low if no ranking input | trademark claims | WATCH/later |
| Curated product placement on Product pages | med — must be labeled | med — never inside comparisons/TerpBot/search ranking | low | med | disclosure | later, only if catalog ships |
| Promoted guides | low fit — knowledge integrity | high — members can't tell editorial vs paid | — | high | disclosure | **don't** |
| Premium member tier | med — never sells XP/standing/unlocks that gate others | low | low | low | subscriptions | maybe later (storage/photos only) |
| Brand posting in feeds | high trust damage | high | high | high | — | **don't** (mirror of GD Threads ads) |

Rule adopted: **paid surfaces may never influence search ranking, comparisons, TerpBot output, XP/standing, or unlock gates.** Sponsorship is always labeled.

---

## PART 13 — The ten open questions, decided

| # | Question | Options | TT evidence | GD evidence | Recommended decision | Why | Unlocks | Intentionally prevents |
|---|---|---|---|---|---|---|---|---|
| 1 | Catalog curation | staff-only / member-suggest+approve / open | no catalog today; `Feedback`/report queues exist | GD = staff-only brand creation | **member-suggest → staff-approve** | keeps data canonical without staff typing every product; suggestion volume bounded | Product growth at community pace | astroturf/impersonation |
| 2 | Brand relationships | none / claimed pages / full media kit | deals infra only | GD media kit €599–3,699/mo | **claimed pages, later** (Phase 5), disclosed | premature now — no catalog, small audience | sponsor contests, brand pages | pay-to-rank, feed ads |
| 3 | Contest judging | community vote / staff / hybrid | voters XP-gated, 1 entry/member | GD staff-picks sponsors' winners | **hybrid**: community for member contests, **staff-judged for sponsored** | sponsorship + vote brigading don't mix | sponsored contest framework | brigaded prize outcomes |
| 4 | Weekly-cadence nudges | none / suggest / enforce | free cadence is identity; BOT_ASSIST stale-diary nudge exists | GD weekly form | **suggest only** (reminders unlock) | enforcement contradicts free-cadence + pseudonymity | `custom-reminders` becomes real | guilt mechanics |
| 5 | Product reviews | none / harvest-only / open | `Report` extensible; no review surface | GD harvest-time reviews on products | **harvest-context reviews, later** | text reviews are the astroturf vector; aggregate evidence (counts, yields) carries most value first | catalog Phase 2+ | open review spam |
| 6 | Push vendor + email | webpush / Expo / FCM+APNs / none | no push at all | GD apps have notifications | **Expo push (single abstraction)** if cross-platform; email stays **out** | one transport both platforms; email violates no-email identity | Phase 0 transport | email collection creep |
| 7 | Platform order | Android / iOS / both | none | GD: Android shipped 1K+ installs, iOS later | **both via one codebase** | audience small; cross-platform cost ≈ single | Phase 4 | two codebases |
| 8 | Achievements vs unlocks order | achievements first / functional first | achievements = zero writers; unlock promises live | — | **functional unlocks first** | a badge engine fixing nothing members can see is wrong order; wire EXPERIMENTATION + dead events first | P0 credibility | another dead pipeline |
| 9 | Short-form content | none / diary moments / full feed | `/feed` + chat cover live | GD Threads beta Aug 2026 | **none now; "diary moments" = week rollup cards** | feed clone fights own identity + like economy | week-view work in Phase 1 | engagement bait |
| 10 | Production volume | — | dev = fixtures | — | **measure before sizing** aggregates/SEO | min-sample thresholds need real counts | Phase 0 telemetry | designing blind |

---

## PART 14 — Specific decisions A–J

| | Decision | Rationale |
|---|---|---|
| A | **Catalog identity before harvest analytics?** — No, parallel: harvest v2 needs no catalog (durations/graphs derive from existing columns); catalog gates *product* reviews and feed presets only. Sequence: harvest v2 Phase 1; catalog Phase 1–2; reviews Phase 5. |
| B | **Promised unlocks before the competitive roadmap?** — **Yes.** P0 integrity outranks parity: members see the roadmap today. Cheap path: (i) wire EXPERIMENTATION events + CONTEST_ENTRY/GUIDE_* or remove them; (ii) resolve 7 vacuous unlocks (mostly retitle/remove); (iii) build the 3–4 cheapest real features (env charts, harvest trends, export-plus, templates) then keep shipping Layer B. |
| C | **Harvest Report V2 feeds TerpBot?** — Yes: plantCount/wet-dry/durations become snapshot facts → better `/review`, harvest-quality bands, retrospective rules. Deterministic only. |
| D | **Structured nutrients/equipment feed TerpBot?** — **Yes, this is the point**: feedChart presets + product specs → dose-out-of-range rules, lamp-distance/PPFD sanity vs fixture specs, "grows on this light" evidence. Via knowledge registry only. |
| E | **Sponsor-funded contests?** — Yes, Phase 5, staff-judged, labeled, zero ledger influence. Compatible with deals infra. |
| F | **Product reviews?** — **Not yet.** Build aggregate product evidence first (harvest counts, yields, ratings-by-verdict); text reviews only after moderation capacity + eligibility rules (harvested diary ≥N updates). If never — acceptable. |
| G | **Brands claim pages?** — Eventually, staff-verified claim flow, labeled, no posting rights, no ranking input. Phase 5+. |
| H | **Member guides as unlock?** — **Yes, but fix the pipeline first**: today even staff publishing awards nothing (`GUIDE_PUBLISHED` dead). Member authoring = guide draft + staff review queue; the event must actually fire before the unlock means anything. |
| I | **Short-form video?** — **No.** Storage/transcode/moderation cost vs Hobby-architecture; week rollup cards capture the same "see the grow fast" value. |
| J | **Native only after versioned API?** — **Yes.** Building against page-shaped routes guarantees the rewrite the task warns about. Phase 0 API/auth/upload/push precedes any client work. |

---

## PART 15 — Build / Don't build / Watch (current head)

**BUILD NOW (P0 integrity — mostly small):**
| Item | Reason | Dep | Value | Complexity | Trust | Differentiates |
|---|---|---|---|---|---|---|
| Wire EXPERIMENT_CREATED/HYPOTHESIS_DOC/EXPERIMENT_COMPLETED/FAILURE_DOCUMENTED/FOLLOWUPS_3 (+REPLICATION if a link exists) | dead path visible on /progress | award keys only | high | low | none | yes — experiments are unique |
| Wire or remove METRIC_FIRST, COVERAGE_MILESTONE, PROBLEM_RESOLVED, CONTEST_ENTRY, GUIDE_PUBLISHED/IMPROVEMENT | advertised, never pay | callsites or config | high | low | none | no |
| Resolve 7 vacuous unlocks (gate real caps or retitle/remove) | promise < reality | decisions | high | low | none | no |
| Env charts + harvest trends (env-analytics, harvest-analytics) | data exists; cheapest real Layer-B | chart component | high | med | none | yes — GD lacks the metrics |
| Sitemap index + drop strain cap | acquisition; 158 strains already invisible | none | high | low | none | no |

**BUILD NEXT:**
| Item | Reason | Dep | Value | Complexity | Trust | Diff |
|---|---|---|---|---|---|---|
| Harvest Report V2 + graph + next-grow clone | harvest climax; feeds TerpBot + comparisons | none | high | med | none | yes |
| Weekly grow view | week presentation w/o weekly form | diary-weeks | high | med | none | yes (richer metrics) |
| Questions stage facet + diary link | answer quality + TerpBot context | Thread fields | med | low | link consent, PUBLIC/UNLISTED only | yes |
| Watch rules basic (terpbot-watch-basic) + Reminder model | the signature unlock pair | snapshot cron | high | med | caps like BOT_ASSIST | yes — GD has nothing close |
| Comparison slots/env (real feature, then gate) | makes comparison-basic/slot-2/env honest | saved view entity | med | med | none | yes |
| Catalog: Brand/Product/Breeder + variant + suggest-link | Part 7 model | none | high | med-high | staff-curated | yes — feeds TerpBot |
| Token auth + `/api/v1` + signed uploads + PushSubscription | mobile foundation | none | high | high | device security | no |

**DO NOT BUILD:** algorithmic short-post feed; short video; like-based ranks/leaderboards; self-service brand accounts or brand posting; DM group chats; strain family tree (now); promoted guides; email collection.

**WATCH:** GD Threads adoption (does it cannibalize diaries?); GD app installs; Shorts as diary medium; sponsored-contest prize economics; whether GD adds diagnostics (threat to TerpBot moat).

---

## PART 16 — Reordered roadmap (dependency-proven)

**Phase I — Integrity (P0, weeks-scale):** wire/dead-event cleanup; resolve vacuous unlocks; env charts; harvest trends; export-plus reframe; sitemap index. *Proof: zero new models needed except none; ships before any catalog.*
**Phase II — Foundation:** catalog models + suggest-link + admin curation; `/api/v1` DTOs + token auth + signed uploads + PushSubscription; `WatchRule`/`Reminder` models (no UI). *Proof: catalog precedes feed presets, product reviews, breeder pages, brands-of-choice; API precedes all mobile.*
**Phase III — Core depth:** harvest v2 + graph + clone; weekly view; questions stage+diary link; comparison slots+env; grow templates; saved views; custom reminders UI; facet counts; breeder/variant/alias pages + JSON-LD. *Proof: weekly view reuses diary-weeks; comparisons reuse strain-stats; catalog pages arrive post-Phase-II.*
**Phase IV — Progression realization (Layer B/C):** watch-basic → watch-advanced → watch-compound; whole-grow review surface; cockpit → dashboard-advanced; data-quality checklist; experiment templates/analysis; historical trends; mentoring routing; member guide authoring + challenge creation; achievements engine. *Proof: watch tiers compound on WatchRule; cockpit composes member-home+intel+quests; mentoring needs achievement engine.*
**Phase V — Intelligence:** community-evidence + research-aggregates (k-anon); symptom→resolution aggregates; feed-chart presets (nutrient-schedules); harvest retrospectives.
**Phase VI — Native mobile:** v1 scope (auth+phrase, diaries+update form+camera, harvest, push, following feed, diary discussion, TerpBot status/next, profile).
**Phase VII — Ecosystem:** sponsored contests; claimed brand pages; product reviews (guarded); product-level affiliate.

This differs from the audit ordering: **integrity is pulled to the front** (it was "Phase 2" there) and **catalog moves up** because three unlocks (nutrient-schedules, comparison depth, feed presets) and two ecosystems (reviews, brand pages) hang on it.

---

## PART 17 — Progression integration map

| Unlock | Underlying feature | Status | Phase | Dependency | Ship order |
|---|---|---|---|---|---|
| streak-dashboard | grow summary cards + streak UI | free-for-all | I | decide gate or retitle | I.1 |
| saved-searches-3/10 | tiered save cap | universal 50 | I | cap tiers | I.2 |
| comparison-basic/slot-2/env/multi | persisted comparisons w/ slots+env | on-page panel only, public | III | comparison entity | III.2 |
| grow-templates | update-form presets | none | III | template model | III.3 |
| quest-slot-4/5 | quest slots | ✅ live | — | — | shipped |
| saved-views | persisted filters | none | III | SavedView model | III.4 |
| members/top-shelf-deals | product.minRank | ✅ live | — | admin tags products | shipped |
| env-analytics | env charts | none | I | chart lib | I.4 |
| harvest-analytics | harvest trends | none | I | harvest shelf data | I.4 |
| grows-6 | active-grow cap | no cap | I | cap decision | I.2 |
| export-tools | richer export (CSV per grow) | JSON account export | I | export shape | I.3 |
| advanced-filters | gated facets | all open | I | gate decision | I.2 |
| custom-reminders | Reminder + delivery | none | III | II model | III.5 |
| terpbot-watch-basic/advanced/compound | WatchRule + snapshot eval | none | IV | II model → basic → advanced | IV.1→.2 |
| longitudinal-analysis | whole-grow review surface | pipeline exists | IV | UI over snapshot | IV.3 |
| images-6/8/10, rate-1.5/2, tags-7, slowmode | perks | ✅ live | — | — | shipped |
| guide-authoring | member guides + review queue + award fix | staff-only, dead event | IV | queue + GUIDE_PUBLISHED writer | IV.6 |
| challenge-creation | member challenges | none | IV | challenge model ext | IV.6 |
| mentoring-tools | mentor routing + achievement engine | none ×3 | IV | achievements | IV.7 |
| nutrient-schedules | Product.feedChart → form prefill | none | V | catalog II | V.2 |
| data-quality-insights | checklist surface | BOT_ASSIST trigger exists | IV | surface + achievement | IV.5 |
| experiment-templates/analysis | template copy + experiment rollup | none + dead path | IV | **wire EXPERIMENT_* first (I)** | IV.5 |
| pinned-harvest, grower-spotlight | — | ✅ live | — | — | shipped |
| grower-cockpit/dashboard-advanced | cockpit compose | none | IV | intel+quests+watches exist | IV.4→.8 |
| historical-trends | self-comparison | none | IV | ≥2 grows + trends lib | IV.5 |
| grow-room/the-vault | gated rooms | ✅ live | — | — | shipped |
| community-evidence/research-aggregates | k-anon aggregates | none | V | aggregate pipeline | V.3 |
| early-access | deals publicAt + feature flags | deals half live | V | flag consumers | shipped+extend |

Rule going forward: **a registry row may only ship with its enforcement callsite or a documented free-tier semantic** — no more "registered but absent" rewards.

---

## PART 18 — TerpBot data strategy

| Data foundation (phase) | Deterministic capability it feeds |
|---|---|
| Canonical Product/feedChart (II) | dose-out-of-range vs published chart; photoperiod/nute-schedule presets; "log missing" nudges per regimen |
| Product specs — light wattage/PPFD (II) | lamp-distance/PPFD sanity vs fixture class; DLI estimate; env comparison peer groups |
| Strain.breederId + variants (III) | per-variant grow norms (flower time, height), alias matching in parser |
| Harvest v2 fields (III) | harvest-quality retrospective rules; yield-vs-peers percentiles (k-anon); "what changed before yield" review |
| Week rollups (III) | week-level deviation baselines; stage-duration norms; BOT_ASSIST stale/flat-line detection upgrades |
| Question↔diary link + stage (III) | `/diagnose` context pull; accepted-answer→symptom-outcome joins |
| WatchRule (IV) | threshold/duration/compound triggers over snapshot — the basic/advanced/compound unlock ladder |
| Experiment outcomes (IV, after I wiring) | experiment rollup summaries; intervention→outcome evidence lines in `/why` |
| k-anon aggregates (V) | community-evidence views; research aggregates; strain×medium×light comparisons |
| NOT promised | anything predictive beyond rule thresholds; cross-member private data; LLM-generated advice |

Boundary preserved: only validated knowledge-registry facts + snapshot data enter evaluation; product marketing text never does.

---

## PART 19 — Trust/privacy guardrails per roadmap item

| Item | Public/private | Blocks | Export | Moderation | Discovery/SEO | Abuse risk | Mitigation |
|---|---|---|---|---|---|---|---|
| Wire dead events | no surface change | — | in ledger export | staff history | — | farming via spam experiments | weeklyCap exists; dup-check applies |
| Vacuous-unlock resolution | lower caps may reduce access | — | — | — | — | member frustration | grandfather existing >cap items read-only |
| Env charts/trends | owner-only | — | exportable | — | — | none | owner scope |
| Harvest v2 | inherits diary visibility | blocks hide | yes | diary rules | PUBLIC only | none new | existing gates |
| Weekly view | diary visibility | blocks hide | yes | — | PUBLIC only | — | — |
| Question↔diary link | link only PUBLIC/UNLISTED, owner consent | block hides | yes | thread rules | linked diary page indexed only if PUBLIC | consent flow |
| Catalog | public catalog | — | — | staff curate | indexable | suggestion spam | approve queue + rate limit |
| Watch/reminders | owner-only | — | yes | — | — | notification abuse | BOT_ASSIST-style caps |
| Comparison slots | owner + PUBLIC sources | blocked sources excluded | yes | — | — | k-anon on aggregates |
| Member guides | published = public | — | yes | review queue + edits audited | indexable | low-effort farming | staff approve + GUIDE_* caps |
| Sponsored contests | public, labeled | — | — | entry moderation | indexable | brigading, sponsor bias | staff judging, no ledger effect |
| Brand claim pages | public entity | — | — | staff verify + ongoing | indexable | impersonation | verification flow |
| Product reviews | public | block hides | yes | Report extends | indexable | astroturf | harvest-eligibility + one-per-product |
| Push/devices | owner | — | yes | revocation audited | — | token theft | rotation + revoke-all |
| Token API | owner | — | — | SecurityEvent | — | replay/theft | short TTL + binding |

---

## PART 20 — TerpTalk product thesis

TerpTalk is the pseudonymous 21+ grow community where **documenting a grow produces compounding returns**: the journal feeds a deterministic expert (TerpBot) that cites evidence back to you, your questions resolve into reusable knowledge, your experiments become community evidence, and the rank ladder pays out in *capability* — deeper analytics, watches, comparisons, reach — never likes or loot. GrowDiaries is a catalog you log into; Reddit/Discord are ephemeral and unscored; generic forums have no grow data model. TerpTalk's advantage is the loop: **structured grow data + community judgment + deterministic intelligence**, under privacy defaults the others don't offer — provided the promises on `/progress` are real.

---

## FINAL REPORT

### Current-head reconciliation
Zero commits since audit snapshot — baseline == HEAD, nothing resolved or obsolete. Re-verification sharpened the core finding: the integrity gap is **four** failure modes, not one.

### Product-integrity findings
14/45 unlocks working · 7 vacuous (feature free for all — worse than unbuilt: the *promise is less than reality*) · 22 not built · 2 partial. Beneath the registry: 13 XP event types with no callsites; EXPERIMENTATION earns nothing (dead path → 2 unlocks doubly unreachable); achievements schema-only (2 more unlock routes dead); `GUIDE_PUBLISHED` advertised but never awarded even for staff; rank-nameplate cosmetic residue survives; legacy dead cosmetic copy in `reputation-config.ts`.

### Locked decisions
Catalog = staff-curated + member-suggest→staff-approve, free text preserved, no monetization coupling. Questions stay thread-based (+stage +diary link). Contests: hybrid judging (staff for sponsored). Native apps only after `/api/v1`+tokens+signed uploads+push. No short feed, no video, no email collection, no paid ranking influence. Functional unlocks before achievements.

### Revised Build/Don't/Watch
See Part 15 — BUILD NOW = integrity batch + env/harvest charts + sitemap index.

### Revised roadmap
I Integrity → II Foundation (catalog + API/auth/upload/push + WatchRule/Reminder) → III Core depth (harvest v2, weeks, questions, comparisons, catalog pages) → IV Progression realization (watches, cockpit, guides/mentoring, achievements) → V Intelligence (aggregates, feed presets) → VI Native → VII Ecosystem.

### Progression integration
Part 17 maps all 45 unlocks → feature → status → phase → ship order. Rule: registry rows ship only with enforcement or documented free semantics.

### TerpBot data strategy
Part 18 — catalog specs/feed charts, harvest v2, week rollups, question links, experiment outcomes, k-anon aggregates → deterministic capabilities only.

### Risks (top)
1. Shipping more features while `/progress` still advertises dead ones — fix first.
2. Vacuous-unlock "resolution" by gating previously-free features → member backlash; prefer retitle/remove over taking things away.
3. EXPERIMENTATION wiring changes the economy mid-flight — award keys must be backfill-safe (no retro XP without a migration decision).
4. Catalog scope creep into monetization before the data layer proves out.
5. Push/email creep against pseudonymity — hold the line at device tokens.
6. Nameplate residue: user previously asked for full cosmetic removal — needs explicit keep/drop decision (recommend keep: it's rank display, not an equippable reward; benefits copy doesn't sell it).

### Final recommendation — next phase to execute
**Phase I (Integrity), in this order:** (1) wire `EXPERIMENT_*` award callsites + `CONTEST_ENTRY` + `GUIDE_*` or remove the types — small diff, kills the dead path and dead earn-list entries; (2) resolve the 7 vacuous unlocks (mostly config/copy decisions); (3) env charts + harvest trends (data already stored); (4) sitemap index + strain cap lift. Then Phase II. Do not start the catalog or native work until (1)–(2) land — every subsequent unlock depends on the registry being honest.
