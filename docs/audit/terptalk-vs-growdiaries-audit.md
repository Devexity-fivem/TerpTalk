# TerpTalk vs GrowDiaries — Competitive Product Audit & Roadmap

> **Reconciliation addendum (2026-09-27)** — verified against current HEAD (`progression-v2 @ 8b6d609`, identical to the audit baseline; zero commits since). See `terptalk-roadmap-reconciliation.md` for the full pass. Corrections to this document:
> 1. §5 "the diary-page comparison is owner-view" is wrong: `buildGrowComparison` renders to **all diary viewers** when strain stats exist — making the `comparison-basic` unlock vacuous, not merely unbuilt.
> 2. The unenforced-unlock finding is understated: 7 unlocks are vacuous (feature free for everyone — saved-search cap is 50 for all, export is open to all, no active-grow cap exists, comparison is public), **13 XP event types have zero award callsites** (incl. all six `EXPERIMENT_*`, `GUIDE_PUBLISHED`, `CONTEST_ENTRY`), the **EXPERIMENTATION mastery path is unearnable**, and the **achievement engine is schema-only** (zero `userAchievement.create` writers).
> 3. Cosmetic residue: rank-derived nameplate classes (`tt-nameplate-*`) still style usernames in chat/thread/cards; legacy `reputation-config.ts` benefit strings still advertise removed cosmetics (dead code).
> 4. Migrations now **66** on dev (garden_perks applied), not 65.
> 5. §14/§16 roadmap ordering superseded: integrity fixes pull to the front; see the reconciliation doc.

**Type:** read-only audit. No application code, schema, database, or production state was changed. Nothing committed.
**TerpTalk baseline:** branch `progression-v2` @ `8b6d609` (7 commits ahead of `master` @ `4611163`; `master` lacks the Progression V2 ledger, Garden Perks and V2 gates described below — everything else is identical). Inventory was verified from source, schema, routes and the 27-suite test registry, not from README claims.
**GrowDiaries baseline:** live site + official journal posts + store listings, observed **2026-09-27** via anonymous fetches. Every competitor claim is tagged in the companion file `docs/audit/growdiaries-evidence.md` (OBSERVED / DOCUMENTED / INFERRED / UNKNOWN, with URLs). This document cites that file by section (`GD §n`).
**Dev-branch content counts** (not production; production volume was deliberately not queried): 658 strains (15 distinct breeders), 8 guides, 22 forum categories; diaries/threads/users on the dev branch are fixtures and are not meaningful.

---

## 1. Executive findings

1. **GrowDiaries is a structured-data platform with a community attached; TerpTalk is a community platform with structured data attached.** GD's diary is a *weekly form* over a *catalog* (7,817 strains with per-breeder product variants, ranked breeder/nutrient/equipment brands with per-product ratings — GD §3–6). TerpTalk's diary is a *free-cadence journal* with a *richer per-update metric set* (night temp, substrate temp, CO₂, PPFD, photoperiod, runoff pH/EC, watering litres, lamp distance — none of which GD captures as fields) but almost no catalog behind nutrients/equipment (free-text `productName`, free-text `lighting`/`equipment`).
2. **TerpTalk's genuine differentiator is already built and GD has no equivalent: a deterministic, evidence-cited grow expert system (TerpBot).** ~10k lines of pure, testable rule/evidence/decision code with a validated knowledge registry, longitudinal episodes, snapshot → decisions pipeline, proactive private BOT_ASSIST alerts, and a least-privilege boundary. GD's help system is human Q&A with a symptom taxonomy (GD §8). Nothing observed on GD does any automated analysis of diary data beyond graphs.
3. **TerpTalk's progression system promises far more than the product enforces.** The V2 unlock registry lists ~45 capabilities; only quest slots, pinned harvest, deals gating, early access, chat rooms, image/tag/rate limits, polls, link trust are wired to `hasUnlock`/perks. Grow comparison exists only as a diary-page panel (not the registry's "comparison slots"); environment charts, export-at-rank, reminders, templates, saved views, watch rules, cockpit, historical trends, community-evidence views, research aggregates and guide authoring are **not built**. Until they are, ranks advertise rewards that don't exist — the highest-priority product-integrity gap found.
4. **GD's catalog is also its business model.** The public `/partner` media kit prices brand pages, "Official Representative" badges, featured placement, buy buttons, custom contests and SEO articles (GD §15). Every brand/product page is a monetizable surface and the source of its structured brand data. TerpTalk's only commercial surface is an affiliate deals catalog with click tracking. Any TerpTalk brand/nutrient/equipment catalog decision is simultaneously a data-model decision and a monetization decision.
5. **GD's diary count is the acquisition engine (108,847 diaries, 68,263 harvested — GD §2), and it is SEO-indexed with auto-generated descriptions and JSON-LD.** TerpTalk's sitemap is capped (500 diaries/strains/profiles, 1,000 threads) and already truncates the 658-strain catalog — an immediate, cheap fix.
6. **Native mobile:** GD shipped Android (`com.growdiaries.droid`, 1K+ installs) and iOS (`GrowDiary`, v1.0 Aug 2026) with a deliberately narrow feature set — auth, profile, diary page, diary search, commenting, feed, add-diary, notifications; chat/contests/questions/brands are roadmap (GD §14). TerpTalk is a responsive PWA with cookie sessions, no token API, no push, a static-only service worker, data-URI uploads capped at ~300 KB, and Pusher realtime. It is *not* mobile-API-ready; the gap is architectural (auth + upload + notification transport), not UI.
7. **Trust/safety and pseudonymity are TerpTalk strengths GD does not match publicly:** username+password+recovery-phrase registration with no email, age attestation, Turnstile, EXIF stripping, PUBLIC/UNLISTED/PRIVATE diaries, block-aware every read path, DM policy, online-status hiding, milestone opt-out, audited staff actions, durable reversal outboxes. GD profiles and diaries are fully public; its guest-visible report mechanism is a "Complain" link (GD §16).
8. **Engagement loops differ in kind.** GD's loop is *social-count* driven: likes, grow score, global position, brand-sponsored monthly contests with cash prizes (704 completed, $500–$6,500 pools — GD §11), a recommendation feed that "learns" from reactions, and Shorts. TerpTalk's V2 loop is *contribution-quality* driven by design (likes pay nothing; standing is peer/staff-judged; one contest entry per member; deterministic Spotlight). TerpTalk should not import GD's like-economy — but it currently lacks GD's *sponsor-funded* reward layer entirely.
9. **Questions:** GD has a dedicated Questions entity with symptom/stage taxonomy, "No Diary" filter and accepted answers. TerpTalk reaches parity through a different shape — forum threads in help categories + 11-group symptom tags + Plant Doctor wizard → thread + accepted answers + TerpBot `/diagnose`. What's missing is a *stage* facet and a diary/week link on questions, not a new entity.
10. **The single most valuable data TerpTalk could add is not more diary fields — it is canonical identity for nutrients and equipment.** TerpBot already reasons about dosing and environment; without canonical products it cannot say "growers on BioBizz at 2 ml/L in coco see X" and comparisons stay strain-only. A small, staff-curated product catalog (not a GD-scale brand marketplace) unlocks comparisons, TerpBot feed-chart presets, structured harvest reports and — optionally — a brand ecosystem later.

---

## 2. GrowDiaries product inventory (from evidence file)

| Domain | What it is | Who / interaction | Data captured | Value type | Maturity | Source |
|---|---|---|---|---|---|---|
| Diaries (`/explore`) | 108,847 week-based journals; filters with live counts (grow type, auto/photo, light type, techniques w/ week ranges, germination method, watering, substrate, language, CBD, Champions, Videos, Questions); sorts by last update / grow score / likes / created | Growers create; public browse | Header: strain+breeder, nutrient brands, VEG/FLO light models, tent, fan, filter, substrate product, room type, pot size, watering volume. Per week: height, light hrs, day/night temp, RH, pH, PPM/EC, smell, pot size, watering, lamp distance, nutrients @ ml/L, techniques | Utility + acquisition + SEO | Mature (V2.0 timeline redesign Feb 2025) | GD §2, §14 |
| Harvest report | Harvest week: strain rating /10, days per stage, dry g per plant, plant count, room size, difficulty, indica↔sativa & sleepy↔energy sliders, multi-series seed-to-harvest graph, per-product equipment reviews | Grower fills at harvest | Yield, ratings, reviews feed strain/brand/product aggregates | Data + trust + monetization (reviews) | Mature | GD §2 |
| Strains | 7,817; facets: genes, conditions, ~50 tastes, effects, effects-to-avoid, difficulty, height, yield, THC, features; sorts by rating/g-plant/harvests/diaries | Editorial + aggregated from diaries | Aliases, THC/CBD, creator, description, family tree (crosses), per-breeder product variants each with own diary/harvest/rating counts, gallery, reviews | SEO + acquisition + data | Mature | GD §3 |
| Breeders (`/seedbank`) | Ranked table (products, growers, diaries, rating, harvests); brand page with Follow/Message, global rank, auto/photo split, bio, tabs (diaries, gallery, growers, harvests, strains, reviews) | Brands (paid) + growers | Brand identity, catalog, aggregated performance | Monetization + SEO + data | Mature | GD §4, §15 |
| Nutrients | Same ranked-brand shape; "Official Representative" badge; products with own ratings; per-week dosing references products | Brands + growers | Product identity, dose, ratings | Monetization + data | Mature | GD §5 |
| Equipment | 22 subcategories (lights → sprayers); brand ranking per category; product cards with harvest counts + ratings | Brands + growers | Product identity, associated harvests, reviews | Monetization + data | Mature | GD §6 |
| Growers | Leaderboard by diaries/likes/signup/last visit with tier badges (Apprentice…Guru), avg g/plant; profile: tagline, Message/Follow, global position, harvests, years growing, followers, auto/photo/indoor splits, "brands of choice" percentages, tabs incl. Threads/Replies/Reposts/Reviews/Bookmarks | Members | Social graph, activity, preferences | Engagement + retention | Mature | GD §7 |
| Grow Questions | Status (New/Open/Solved/No Diary), stage facet, symptom tree (Buds/Leaves/Plant/Roots/Setup/Feeding/Techniques/Other), popularity sort, "Selected by the Grower" accepted answer, per-answer Complain | Members | Question, photo, stage, symptom tags, week, accepted answer | Utility + retention + SEO | Mature | GD §8 |
| Threads (beta, Aug 2026) | Live feed: Recommendation (learns from reactions) / Trends / Search; posts with text, multi-image, links/embeds, topics, hashtags, @mentions, like/comment/repost/share/translate; brand accounts post natively; NSFW tag | Members + brands | Short-form posts, reactions | Engagement + retention (+ ads) | Beta | GD §9 |
| Shorts | Vertical video keyed to diary + week; filters auto/photo, stage, week; Likes/Comments/Share/Complain; creator follow | Members | Video, diary/week link | Engagement + acquisition | Mature-ish (2025) | GD §10 |
| Contests (`/giveaways`) | Continuous sponsored contests (€460–$6,500 pools, 38–148 participants), GD-run Diary/Photo/Grower/Meme of the Month; 704 completed; winners "picked by GD Team"; entrant tables show rank + g/watt; Grow Awards event | Sponsors + members | Entries, sponsor relationships | Monetization + engagement | Mature | GD §11 |
| Search | Topbar rotating-placeholder search; Threads-scoped search over conversations/growers/topics/hashtags; scope list not captured | Members/guests | — | Discovery | Mature (scope UNKNOWN) | GD §12 |
| Feed/notifications/messages | V2.3: For You / Following / Messages tabs, @-mention notifications, group chats, per-item delete, opt-outs | Members | — | Retention | Mature | GD §14 |
| Mobile apps | Android + iOS (Sep 2026): auth, profile, full diary page, diary search, commenting, update feed, add/update diary + photo upload, notifications; roadmap: chat, contests, questions, brand pages | Members | — | Retention + acquisition | v1.0.x, low install base (1K+) | GD §14 |
| SEO | Slugged URLs for diaries/strains/questions/brands; auto-summarized meta descriptions; JSON-LD `DiscussionForumPosting` on diaries; sitemap index (contents not enumerable); locale subdomains without hreflang | — | — | Acquisition | Mature | GD §13 |
| Monetization | Public media kit: plans €599–3,699/mo; priced banners, newsletter, brand pages, ad-free brand page, custom contests, SEO articles, buy buttons, featured brand, category top spots; tracked `/api/v1/redirect` | Brands | — | Revenue | Mature | GD §15 |
| Trust & safety (guest-visible) | Complain links, Turnstile, staff-only brand creation, NSFW tags, 17+/18+ store ratings; profiles fully public; no web age gate; no visible moderation policy | — | — | Trust | Partial / UNKNOWN | GD §16 |

**Not reachable:** sitemap child contents, `/seeds`, one question page, all login-only editors (GD "Blocked").

---

## 3. TerpTalk inventory (verified from code)

### Community
- **Forums:** 22 categories (general, new-grower-questions, plant-problems, greenhouse/indoor/outdoor, soil, hydro, DIY, lighting, smoke reports, off-topic, ventilation, genetics, seeds, nutrients, training, flowering, harvest-curing, advanced, memes); threads with slugs, images, tags (`Tag`/`ThreadTag`), polls (Trusted-standing to create, Known to vote), accepted answers (with newcomer/OP bonuses), thread follows, similar-thread lookup, symptom-tag route, view counting, pin/lock, staff move/delete.
- **Questions surface:** `/questions` page over help categories (no separate model); Plant Doctor wizard (`problem-wizard.ts`, deterministic nodes → results) creates tagged threads via 11-group `symptom-tags`; TerpBot handoff.
- **Feed & discovery:** `/feed` (Latest / Following / For You, mixed threads + diary updates, block-aware, PUBLIC-only on global tabs); `/discover`; `/forum/updates`.
- **Reactions/bookmarks/follows:** reactions on posts/diaries; bookmarks; user/category/thread/diary follows; onboarding interests + suggested users.
- **Search:** unified `/api/search` over threads, strains, users, diaries, guides, setups, tags with match-centred excerpts, category scoping, pagination; `/api/search/suggest`; saved searches (name + filters).
- **Chat:** Pusher realtime rooms with `requiredXp` + standing gates from the unlock registry (Grow Room, Vault), slow mode, lock, presence teaser, 60+ slash commands (public + staff), message report, DMs (`DirectMessage`, `dmPolicy` EVERYONE/FOLLOWING/NONE).
- **Notifications:** persisted, grouped (`groupKey`), metadata-carrying, Pusher-delivered in-app; per-type prefs; no web/mobile push.
- **Profiles:** pseudonymous username, avatar, bio, location/website, business fields, badges (legacy, archived-in-place), rank/XP/standing chips, mastery build title, harvest shelf, most-grown strains, pinned harvest, public progression history (safe labels), grow streak (opt-out aware), follow/DM/block actions, member card popover.
- **Blocking/reporting/moderation:** `Block` honoured on every read path; `Report` (thread/post/chat/profile/diary/setup) with priority, assignment, escalation; moderation queue + bulk; `ModerationAction` audit; `SecurityEvent`; `AbuseFlag`; staff applications; announcements; restricted mode; maintenance mode; admin audit/security/reputation/users/media/settings/experiments/features/growth/retention/youtubers.

### Growing
- **Diaries:** `GrowDiary` with slug, structured header (grow type, medium type, container, light type, techniques[], space, nutrients/equipment free-text, `strainId` link or free-text strain, optional `setupId`, lazily created canonical discussion thread), visibility PUBLIC/UNLISTED/PRIVATE, stage enum (germination → completed), featured flag.
- **Updates:** free cadence (weeks derived from `createdAt`, never trusted from user input); 17 structured metrics (temp, night temp, RH, VPD, pH, EC, height, substrate temp, CO₂, watering L, PPFD, photoperiod, runoff pH/EC, lamp distance) + feeding/training text + `DiaryUpdateNutrient` (product name + ml/L) + images; edit/delete with progression reversal; meaningful-update predicate; simhash duplicate withholding; quality bands.
- **Experiments:** `GrowExperiment` (change, reason, expected, category, status, outcome, conclusion, baseline) with follow-up updates and chat `/experiment` commands.
- **Harvest:** yield + unit (conversions), 1–10 strain verdict, difficulty, notes, structured `lessons` JSON; feeds strain stats and `/leaderboard/yields`. No per-plant weights, no wet weight, no equipment reviews.
- **Strains:** 658-row catalog with slug, genetics, breeder (string), type, effects[], flavors[], THC min/max, flowering weeks, seed-to-harvest weeks (autos), difficulty, breeder image/source attribution, description, growing info; grower photos (PLANT/FLOWER); `strain-filters` (THC bands, flower bands, type, effects…); breeder grouping pages `/strains/breeder/[name]`; `getStrainGrowStats`/`getStrainEvidence` aggregate public diaries (min-sample gated); `suggestStrainLink` for free-text diaries; strain lifecycle/prune safety tests.
- **Setups:** `GrowSetup` showcase (space, tent, lighting, ventilation, fans, containers, medium, nutrients, controllers, equipment — all free text) with images, comments, diary linkage.
- **Comparison:** `buildGrowComparison` — descriptive "your grow vs community median" rows on the diary page (owner view), strain-scoped, min-sample gated. Not the multi-slot comparison the unlock registry describes.
- **Calculator:** grow-light cost/coverage calculator page.
- **Media:** client-resized PNG/WebP/JPEG data URIs ≤ ~300 KB → Vercel Blob (JPEG re-encoded to WebP to strip EXIF/GPS); YouTube/Vimeo embeds; no native video upload.

### Knowledge
- **Guides:** staff-authored, topic-tagged, edit history (`GuideEdit`); 8 published on dev. Member guide authoring is a registry promise, not built.
- **TerpBot (deterministic, no LLM):** `terpbot-nl-parse` (pure text → observations/measurements, never diagnoses) → `terpbot-intel` (3.7k-line rule/evidence engine over `GrowContext`; candidate knowledge in 9 domain modules with cited `sources`; validator lint; contra/refinement tables) → episodes (derived, never persisted) → timeline (derived-on-read) → **Grow Intelligence Snapshot** (single source of truth) → **decision engine** (`/next /check /plan /status /changes /why`) → renderers. Owner-scope diary intel API and diary-page panel (`getGrowIntel`, attention/posture). **BOT_ASSIST** daily cron: trigger registry over merged owner context, ≤1 private notification/day/grower, 3/day cap, 7-day cross-kind cushion, opt-out pref. `BotSession` continuity stores bounded structured state only (no message text). Intent router maps `@terpbot` free text only to public commands; moderation vocabulary hard-blocked. Bot user skipped by award engine; no admin/moderation/security/report/block authority; reads public-class data only. Telemetry via `BotEvent`. **Not built:** watch rules, reminders, cross-grow analysis, community-evidence views.

### Progression (branch state)
- Dual ledger: `Profile.xp` + `Profile.standing` with `ProgressionEvent` (keyed, reversible, actor-attributed), `MasteryProgress` cache; legacy `ReputationEvent` frozen. 13 ranks with sub-levels, 5 mastery paths (Growing/Journaling/Helping Out/Experiments/Community), build titles, diversity floors. Standing anti-abuse (weekly cap 40, per-source, per-grantor lifetime, reciprocal/cluster discounts, grantor age floor). Daily quests (3–5 slots), weekly challenges, Getting Rooted journey, per-diary grow journey with clawback, check-in streak (0 XP markers) + grow streak, weekly recognition + Grower of the Week, Budshot weekly contest + monthly diary contest (community votes, XP-gated voters), referrals (deferred, keyed), achievements schema (Phase 9 unbuilt), Garden Perks (pinned harvest, Spotlight, rank-gated deals, first look). Unlock registry ~45 entries; **enforced today:** quest slots, pinned harvest, early access, chat rooms, image/tag/rate perks, polls, link trust.

### Trust & safety
- Registration: username + password + age attestation + Turnstile (math captcha dev fallback), optional referral; **no email**; recovery phrase (`recoveryPhraseHash`) for account recovery; account deletion with cascading ledger reversal (both outboxes) and blob cleanup; JSON data export. Session validity checks, role model (member/staff/admin), rate limits (DB-backed), input `LIMITS`, link trust gate (standing + age), profanity filter, markdown sanitisation, CSP/headers verified in production-mode suite. Privacy toggles: `hideOnlineStatus`, `publicMilestoneOptOut`, `dmPolicy`, diary visibility. Trust signals (velocity, reciprocal-accept detectors). Ops metrics page.

### Mobile readiness (factual)
- Responsive Tailwind UI; PWA manifest with shortcuts; service worker caches static assets only; `sw-register`. **No** web push, **no** token/bearer API (next-auth cookie sessions only), **no** deep-link scheme, **no** camera-capture hints, uploads are base64 data URIs with a ~300 KB cap, realtime via Pusher (works from native SDKs), API responses are Next route handlers shaped for the web client (some page-coupled). Cron via Vercel cron routes.

### Testing
27 permanent suites in `scripts/master-tests.mts` across fast/full/slow tiers (security invariants, UI contracts, TerpBot parser/intelligence/decisions, account/forum/search/diary/bot/trust-safety HTTP, runtime black-box, security lib, notifications, reputation, referral integrity, TerpBot pipeline, self-service, chat, community analytics, content-edit, strain lifecycle, rewards3, discovery+sitemap, ops, check-drift, production-mode).

---

## 4. Master feature matrix

Status key: **MATCH** · **PARTIAL** · **GD ONLY** · **TT DIFF** (TerpTalk differentiator) · **N/R** (not relevant) · **UNKNOWN**.

| Domain | GrowDiaries | TerpTalk | Status | Concrete gap | User value | Complexity | Dependency | Recommendation |
|---|---|---|---|---|---|---|---|---|
| Diary timeline | Weekly form, scroll timeline, per-week likes/comments | Free-cadence updates, derived weeks, richer metrics | PARTIAL | No week-level summary view; no per-update comments (discussion is one thread) | High | Med | diary-weeks.ts | BUILD week rollup view; keep free cadence |
| Per-update metrics | 10 fields + nutrients ml/L | 17 fields + nutrients ml/L | TT DIFF | GD has "smell", pot size per week; TT lacks pot size per update | Med | Low | — | Add pot/container per update; keep lead |
| Nutrient identity | Brand + product catalog, ratings, dosing links | Free-text `productName` | GD ONLY | No canonical product → no aggregation | High (data) | Med | new `Product` model | BUILD small curated catalog |
| Equipment identity | 22 categories, brands, models, ratings, harvest counts | Free text on diary/setup | GD ONLY | Same | High (data) | Med–High | Product model | BUILD lights/tents/meters first |
| Harvest report | Per-plant dry g, stage durations, sliders, graph, equipment reviews | Yield, rating, difficulty, notes, lessons | PARTIAL | No per-plant, no wet/dry, no stage-duration display, no seed-to-harvest graph, no product reviews | High | Med | metrics already stored | BUILD graph + wet/dry + plant count |
| Strain catalog | 7,817; aliases, family tree, product variants, ~50 tastes, conditions, effects-to-avoid, reviews | 658; THC/flower/type/effects/flavors/difficulty, photos, grow stats | PARTIAL | Volume; breeder is a string; no variants/aliases/tree/reviews | High (SEO/data) | Med | Breeder model | BUILD Breeder entity + variants; WATCH tree |
| Breeder ecosystem | Ranked, followable, messageable brand pages | Breeder grouping pages from strings | PARTIAL | No entity, no brand accounts | Med | Med | Breeder model | BUILD entity; DON'T BUILD brand accounts yet |
| Grow Questions | Dedicated entity, stage facet, symptom tree, No-Diary filter, accepted answers | Threads + symptom tags + wizard + accepted answers | PARTIAL | Stage facet; diary/week link on questions | Med | Low | Tag infra | BUILD stage tag + diary link |
| Deterministic diagnostics | None observed | TerpBot engine + BOT_ASSIST | TT DIFF | — | High | — | — | Invest (Phase 3) |
| Grow comparison | Not observed (only graphs) | Strain-scoped median rows (owner) | TT DIFF | Registry promises slots/env/multi | High | Med | product catalog for deeper cuts | BUILD what registry promises |
| Feed | Threads: recommendation that learns, trends, reposts, translate, brand posts | Latest/Following/For You mixed feed | PARTIAL | No short-form post type; no reposts; no topics | Med | Med | — | DON'T BUILD engagement feed clone; WATCH |
| Short video | Shorts keyed to diary week | None | GD ONLY | Video entirely absent | Med | High (storage, moderation, cost) | Blob/cost model | DON'T BUILD now; WATCH |
| Live chat | Group chats in Messages (V2.3) | Realtime rooms + commands + TerpBot | TT DIFF | — | High | — | — | Keep |
| Contests | Continuous sponsored cash contests, staff-picked winners, monthly GD contests | Weekly photo + monthly diary, community votes, XP | PARTIAL | No sponsor layer, no prizes, no admin-defined categories | High (engagement) | Med | Contest model generalisation | BUILD sponsored-contest framework |
| Growers directory | Sort by likes/diaries; tier badges; g/plant | XP leaderboard; rank/standing chips | MATCH | GD exposes likes; TT intentionally doesn't | — | — | — | Keep |
| Profile | Brands-of-choice %, reposts/reviews tabs, global position | Rank/mastery/standing, harvest shelf, pinned harvest, streak | MATCH/PARTIAL | No "brands of choice" (needs catalog) | Med | Low after catalog | Product model | LATER |
| Search | Topbar + Threads search (scope unknown) | 7-entity unified search, saved searches | MATCH+ | Unknown GD scope | — | — | — | Keep; add products later |
| Diary discovery filters | ~30 facets with live counts | Discovery filters (type/medium/light/stage…) | PARTIAL | Live counts; technique-week filters; germination/watering method | Med | Low–Med | fields exist | BUILD facet counts |
| Notifications | For You/Following/Messages tabs, opt-outs | Grouped in-app + Pusher, prefs | MATCH (web) | No push | High (mobile) | Med | push infra | BUILD (Phase 0/4) |
| Messages | DMs + group chats | DMs with policy | PARTIAL | No groups | Low | Med | — | DON'T BUILD now |
| Native apps | Android + iOS v1.0.x | PWA | GD ONLY | Token auth, push, uploads, API contracts | High | High | Phase 0 | BUILD after foundation |
| Pseudonymity/privacy | Public profiles, no visible controls | No-email signup, recovery phrase, visibility tiers, blocks everywhere | TT DIFF | — | High | — | — | Preserve |
| Progression | Likes, grow score, global position, tiers | XP/standing dual ledger, mastery, quests, unlocks | TT DIFF (design) / PARTIAL (delivery) | Promised unlocks unbuilt | High | Med–High | — | BUILD promised unlocks before adding new ones |
| Monetization | Media kit, brand pages, contests, ads, buy buttons | Affiliate deals + click tracking, rank-gated deals | GD ONLY | No brand relationships, no sponsor tooling | Med | Med | catalog + contests | LATER (Phase 5) |
| SEO | Slugs, JSON-LD, auto meta, sitemap index | Slugs, JSON-LD on diaries/threads/guides, breadcrumbs, capped sitemap | PARTIAL | Sitemap caps; no strain JSON-LD; no question landing pages by symptom | High | Low | — | BUILD now (cheap) |
| Trust & safety | Complain links, Turnstile | Full moderation stack, audits, reversals | TT DIFF | — | High | — | — | Preserve |
| Age gating | Store 17+/18+; no web gate | 21+ attestation at signup | TT DIFF | — | Trust | — | — | Preserve |

---

## 5. Deep gap analysis (meaningful gaps only)

### 5.1 Canonical nutrient & equipment identity
- **GD:** brand → product catalog; per-week dosing references products; per-product ratings and harvest associations; brands are paid pages (GD §5–6, §15).
- **TT:** `DiaryUpdateNutrient.productName` free text; `GrowDiary.nutrients/lighting/equipment` and `GrowSetup.*` free text; `grow-fields.ts` explicitly avoids a "GrowDiaries-style catalog".
- **Missing:** a `Product` (+ `Brand`) entity with category, and nullable FKs from `DiaryUpdateNutrient`, `GrowDiary`, `GrowSetup`. Free text must remain as fallback (design intent preserved).
- **Important?** Yes — it is the prerequisite for every "grows like mine" cut beyond strain, for TerpBot feed-chart presets (`nutrient-schedules` unlock), for harvest equipment reviews, and for any brand ecosystem. Improves grow-data quality (high), TerpBot (high), retention (med), acquisition/SEO (med: product pages are indexable). Abuse/privacy: low if products are staff-curated + member-suggested (GD does the same: users cannot add brands — GD §16). Infra: 2 models, suggest-link helper (mirror `suggestStrainLink`), admin curation UI, search entity. Mobile: pickers must be API-shaped (typeahead endpoint).

### 5.2 Harvest report depth
- **GD:** per-plant dry weight, plant count, stage-duration split, indica↔sativa/sleepy↔energy sliders, multi-series seed-to-harvest graph, equipment reviews (GD §2).
- **TT:** `yieldAmount/yieldUnit`, `harvestRating`, `harvestDifficulty`, `harvestNotes`, `lessons`; stage durations derivable (`diary-weeks.ts`, timeline); every graph series already exists as `DiaryUpdate` columns.
- **Missing:** `plantCount`, `wetWeight`, per-plant derivation, the graph UI, and reviews (needs 5.1). Value: high for retention (harvest is the natural climax) and for strain/yield aggregates (`/leaderboard/yields` becomes g/plant-capable). Complexity: low–med (fields + a chart component over existing data). TerpBot: enables `HARVEST_REPORT` quality scoring on real completeness.

### 5.3 Progression promises vs delivered capability
- **Missing:** comparison slots, env charts, export-at-rank, advanced filters, reminders, templates, saved views, watch rules (basic/advanced/compound), longitudinal review surface, cockpit, historical trends, community-evidence, research aggregates, guide authoring, challenge creation, mentoring tools.
- **Important?** Critical for trust in the progression system — "every rank has ≥1 functional unlock" is a design invariant currently false at Vegged, Trained, Preflower, Flowering, Ripening, Harvested (partially), Cured, Master Cultivator. Improves activation/retention directly. No new abuse vectors if built as read-only analytics over the member's own data; community-evidence views need k-anonymity (already specified). Infra: mostly UI + pure derivations over existing rows; watch rules need a `WatchRule` model + cron evaluation via the existing snapshot; reminders need a `Reminder` model + delivery (in-app now, push later).

### 5.4 Breeder entity & strain variants
- **GD:** breeder pages with ranking/rating/harvests; strain page lists per-breeder product variants with their own counts; aliases; family tree (GD §3–4).
- **TT:** `Strain.breeder` string, grouping pages, `breeders.ts` normaliser; no variant concept (one strain row per name, `@unique`).
- **Missing:** `Breeder` model (name, slug, country, site, image/attribution), `Strain.breederId`, and a `StrainVariant`/(breeder × strain) join so "Runtz by X" and "Runtz by Y" aggregate separately yet roll up. Aliases as a `Strain.aliases String[]`. Family tree: WATCH — needs curated parent links; low value until catalog is large. Value: high for SEO (breeder + variant pages), med for data. Complexity: med (uniqueness migration of `Strain.name`). Abuse: brand impersonation if brands can self-register — keep staff-curated.

### 5.5 Questions: stage facet + diary link
- **GD:** stage filter, "Week N" tags, No-Diary state (GD §8).
- **TT:** symptom tags exist; diaries have discussion threads; wizard results map to tags.
- **Missing:** a controlled `stage:` tag family (or `Thread.stage`), optional `Thread.diaryId`/`updateId` link so TerpBot and answerers see the grow context, and an "asked from diary week N" chip. Value: med–high for answer quality and for TerpBot's `/diagnose` context. Complexity: low. Privacy: only link PUBLIC/UNLISTED diaries; owner-only intel never leaks.

### 5.6 Sponsored contests / reward layer
- **GD:** continuous brand-funded contests, cash pools, staff-picked winners, entrant metrics (GD §11).
- **TT:** two fixed contests, community votes, XP rewards, one entry per member.
- **Missing:** admin-defined contest definitions (title, window, entry type diary/photo, categories, sponsor, prize text, judging mode), entry tables, winner handling that pays through the existing keyed `CONTEST_*` events. Value: high for engagement and the only realistic non-ad revenue lever compatible with the deals model. Abuse: vote brigading (already mitigated by XP-gated voters; staff-judged mode avoids it), sponsor influence on ranking (never let sponsorship touch XP/standing). Complexity: med.

### 5.7 SEO surface
- **GD:** ~109k diary pages, 7.8k strain pages, brand pages, question pages all indexed with slugs and JSON-LD (GD §13).
- **TT:** sitemap caps (500/1000) — strains already exceed the cap; no JSON-LD on strain/breeder/question pages; no symptom/stage landing pages; `/questions` exists but individual help threads carry generic thread schema.
- **Missing:** paginated sitemap index, `Product`/`Breeder`-ready sitemap entries, strain `Product`-type JSON-LD (or `Thing` with aggregate rating from harvest verdicts, min-sample gated), `QAPage` schema on solved help threads, symptom-tag landing pages (`/forum/tags/[slug]` exists — add copy + solved-first ordering). Value: high, complexity: low. Privacy: only PUBLIC content; never index UNLISTED/PRIVATE or profiles of members who opted out.

### 5.8 Mobile API foundation
- **Missing:** bearer/refresh-token auth (next-auth credentials issue cookies only), a versioned `/api/v1` contract for diary CRUD/update/upload/feed/notifications, multipart or signed-URL uploads (data-URI cap is a mobile blocker for photos), push transport (Expo/APNs/FCM or web push), deep-link routes, background upload semantics. Realtime (Pusher) and rate limiting already work from native. Complexity: high; unlocks Phase 4 entirely.

### 5.9 Short-form content (Threads, Shorts)
- **GD:** engagement feed + vertical video (GD §9–10).
- **TT:** forum threads, chat, feed of threads+diary updates.
- **Assessment:** copying is a poor fit — TerpTalk's identity is durable, searchable knowledge plus live chat; an algorithmic short-post feed competes with both and reintroduces like-economy incentives the V2 design removed. Video costs (storage, transcoding, moderation) are incompatible with a Hobby-conscious Vercel/Blob posture. **WATCH**; a bounded alternative is "diary moments" — a photo-first, week-keyed update card format inside the existing feed (no new content type).

---

## 6. TerpTalk differentiators (where architecture creates opportunity GD does not show)

1. **Evidence-cited deterministic diagnostics.** The knowledge registry cites sources per candidate and the `/why` trail exposes reasoning. GD offers human answers only. Extending this to longitudinal baselines (already derived), watch rules, and harvest-time retrospectives ("what changed before yield dropped") is a category GD does not occupy.
2. **Owner-scope grow intelligence that respects privacy.** Snapshot/decisions run over the owner's own data with public-class fallbacks; BOT_ASSIST delivers privately. Community-evidence views can be k-anonymized by construction (design §8). GD's equivalents are public counts.
3. **Higher-fidelity environment data.** Night temp, substrate temp, CO₂, PPFD, photoperiod, runoff pH/EC, lamp distance are first-class columns. With charts and comparisons on top, TerpTalk can answer questions GD's data cannot (VPD day/night, runoff drift, DLI).
4. **Experiments as a first-class object.** `GrowExperiment` with hypothesis/outcome/conclusion has no GD analogue; aggregated across members (min-sample, anonymized) it becomes "what interventions worked for symptom X in stage Y" — evidence TerpBot can cite.
5. **Question → diagnosis → diary loop.** Wizard → tagged thread → accepted answer → `PROBLEM_RESOLVED` XP → TerpBot episodes marking resolution. Closing the loop (link question to diary week, feed accepted answers back as candidate evidence) is unique.
6. **Contribution-quality progression.** Likes pay nothing; standing is judgment-gated; unlocks are functional. This is a defensible identity *if* the promised unlocks ship.
7. **Pseudonymity + trust tooling.** No-email accounts, visibility tiers, block-aware reads, audited moderation, reversible ledgers — a structural advantage for a 21+ cannabis audience that GD's fully-public profile model doesn't offer.
8. **Realtime community with a bot participant.** Chat rooms gated by rank+standing plus TerpBot commands in-room; GD has group chats only.

**Emergent loops from combining systems:** diary update → TerpBot snapshot → attention flag → `/next` → experiment logged → follow-up updates → outcome → strain/product evidence → comparison for the next grower → question answered with cited evidence → standing for the answerer → unlock deeper analytics → richer logging. Every step already has a table or module; what's missing is the connective UI and the catalog.

---

## 7. Data architecture opportunities

| Dataset | Exists today | Add | Powers |
|---|---|---|---|
| Environment series | `DiaryUpdate` metrics | pot size per update; derived VPD/DLI columns or view | charts, comparisons, watch rules, TerpBot baselines |
| Nutrient usage | product name + ml/L | `Brand`, `Product(category)`, `DiaryUpdateNutrient.productId?` | feed presets, dose comparisons, product pages, reviews |
| Equipment | free text | `Product` (lights/tents/fans/filters/meters/controllers first), `GrowDiary`/`GrowSetup` product links (many-to-many `DiaryProduct`) | "grows with this light", harvest reviews, TerpBot lamp-distance/PPFD sanity |
| Genetics | `Strain` + breeder string | `Breeder`, `Strain.breederId`, `StrainVariant`, `aliases[]`; parents later | SEO pages, per-breeder stats, variant comparisons |
| Harvest | yield/rating/difficulty/lessons | `plantCount`, `wetWeight`, `dryWeight` (rename semantics), stage durations derived | g/plant, g/W (with light wattage from product), harvest graph, leaderboard |
| Symptoms/resolutions | TerpBot observations (session-bounded), symptom tags on threads | `Thread.stage`, `Thread.diaryId?`; optional persisted *anonymized* symptom→resolution aggregate (staff-run, k≥N) | Questions facets, TerpBot evidence weighting |
| Experiments | full model | cross-member anonymized aggregate (min-sample) | `experiment-analysis`, community evidence |
| Social graph | follows, blocks, DM policy | none needed | — |
| Ratings/reviews | harvest verdict only | `ProductReview` at harvest (rating + short text, one per product per diary) | product pages, brand trust; needs moderation + anti-astroturf |
| Watch/reminders | none | `WatchRule`, `Reminder` | unlocks, push |

Never collect: real names, emails (unless opt-in for recovery later), precise location, purchase data, device identifiers beyond what push requires. Aggregates published only above a min-sample threshold (reuse `getStrainGrowStats` gating).

---

## 8. Mobile comparison

**GD apps (DOCUMENTED, GD §14):** auth, profile tabs, settings, full diary page, diary search, commenting, update feed, add/update diary with photo upload (background upload fixed in 1.0.4), notifications, deep links; roadmap chat/contests/questions/brand pages. Low install base (1K+ Android) months after launch — the web remains primary.

**TerpTalk today:** responsive web + PWA shell; realtime via Pusher; cookie auth; base64 uploads; no push; no API versioning.

**First native release should contain (and nothing more):** sign in/up + recovery phrase, diary list/detail, **log an update with camera photos and the metric form**, harvest form, notifications (push), following feed, comments on diary discussion, TerpBot `/status`/`/next` for own diaries, profile view. Defer: forum authoring, chat, contests, admin/moderation, deals.

**Design now so mobile needs no rewrite:** token auth alongside cookies; `/api/v1` DTOs decoupled from page components (start with diaries, updates, notifications, feed); signed-URL uploads with server-side re-encode; push subscription table + delivery abstraction behind `notify()`; deep-link path table (`/d/[slug]`, `/t/[slug]`); idempotency keys on update POST (offline retry); rate-limit keys that accept device ids.

---

## 9. SEO / discovery comparison

| Surface | GD | TT | Opportunity |
|---|---|---|---|
| Strain pages | 7,817 indexed, rich facets, variants | 658, capped at 500 in sitemap | Lift cap (paginate); add JSON-LD with min-sample aggregate rating; breeder pages already exist |
| Breeder/nutrient/equipment pages | Yes, ranked | Breeder string pages only | After catalog: `Product`/`Brand` pages — high-value, low duplication risk if staff-curated |
| Diary pages | Auto meta description, JSON-LD | JSON-LD + breadcrumbs, 500 cap | Lift cap; PUBLIC only (already) |
| Question pages | Slugged, solved badge | Thread pages | `QAPage` schema for solved help threads; symptom/stage landing pages via existing tag pages |
| Profiles | Fully public | Public, opt-out aware, 500 cap | Keep cap modest; never index opted-out or low-activity profiles (low value/duplicate risk) |
| Tags | Hashtags (client) | `/forum/tags/[slug]` in sitemap | Add editorial copy to symptom tags |
| Keep private/noindex | — | /profile, /settings, /messages, /notifications, /feed (already) | Also noindex UNLISTED diaries (verify `publicDiaryWhere` excludes them from sitemap — it does) |
| Low value | — | leaderboards, calculator | Fine as-is |

---

## 10. Retention-loop comparison

**GD loop (INFERRED from UI):** start diary → weekly form + photos → likes/comments/grow score → appear in explore/feed/Shorts → enter sponsored contest → harvest report + reviews → strain/brand pages gain data → new grower discovers via SEO → repeat. Return triggers: weekly cadence, notifications (For You/Following), contests, Threads recommendations.

**TT loop (from code):**
- First session: landing → sign up (no email) → onboarding interests/follows → Getting Rooted journey → daily quests.
- First grow: `/diaries/new` (strain link suggestion) → update form → TerpBot attention on diary page → stage XP.
- First post/answer: forum/questions → accepted answer → standing.
- First follow/chat: onboarding suggestions; chat rooms open at Seed.
- First unlock: Germinated (60 XP) → *promised* summaries/streak dashboard (**weak link: not built**).
- Recurring update: grow streak, `UPDATE_DAY`, BOT_ASSIST private nudges, stale-diary next-action on member home.
- Return triggers: in-app notifications only (**weak link: no push/email**), weekly challenges, GotW, Spotlight.
- Harvest: harvest form → strain stats → harvest shelf/pinned harvest → `GROW_COMPLETE` (**weak link: no harvest graph/retrospective, no product reviews**).
- Next grow: no explicit "start next grow from this one" path (**weak link**).

Weakest links, in order: unbuilt early unlocks; no push; thin harvest climax; no next-grow transition; per-update comments absent (discussion is one thread, so week-level social feedback is weaker than GD's per-week likes/comments).

---

## 11. Trust & safety implications of roadmap items

| Item | New vector | Mitigation |
|---|---|---|
| Product catalog + reviews | Astroturfing, brand impersonation, affiliate bias | Staff-curated products; reviews only from diaries with ≥N updates and a harvest; one review per product per diary; reviews pay 0 XP/standing; affiliate links disclosed; no brand accounts initially |
| Sponsored contests | Vote brigading, sponsor influence, prize fraud, gambling-law exposure | Staff-judged mode; XP-gated voters (exists); sponsorship never touches XP/standing; prize fulfilment off-platform with clear terms; age 21+ already |
| Breeder/brand pages | Impersonation, defamation in reviews | Staff-created only; moderation queue covers reviews (`Report.type` add PRODUCT_REVIEW) |
| Watch rules / reminders | Notification spam, data inference | Per-user caps (reuse BOT_ASSIST 3/day pattern); owner-only data |
| Community-evidence / research aggregates | Re-identification | k-anonymity threshold, no per-diary drill-down, PUBLIC-only sources (design §8 already) |
| Push notifications | Token leakage, tracking | Store tokens per device with revocation on logout/deletion; no third-party analytics payloads |
| Token auth for mobile | Token theft, replay | Short-lived access + rotating refresh, device binding, revoke-all on password change/deletion |
| Question ↔ diary link | Leaking UNLISTED/PRIVATE grows | Link only PUBLIC/UNLISTED with owner consent at ask time |
| Live facet counts | Enumeration of private content | Counts over PUBLIC rows only |
| Short video (if ever) | CSAM/NSFW moderation load, cost | Not planned |

---

## 12. Monetization observations

**GD (OBSERVED, GD §15):** tiered brand plans (€599–3,699/mo), sitewide/section banners, newsletter slots, brand pages with ad-free upsell, buy buttons, featured brand, category top spots, custom contests, SEO articles; tracked outbound redirects; Official Representative badges; brands post in Threads. Contest prize pools are sponsor-funded.

**TerpTalk-compatible directions (no fake engagement, no coercion, pseudonymity intact):**
1. Affiliate deals (exists) → extend with product-page-level affiliate links once the catalog exists; keep rank-gated exclusives modest.
2. Sponsored contests with staff judging and transparent sponsor labelling; no XP/standing effect.
3. Brand pages as *claimed* (not self-created) entities with disclosure, optional paid "featured" placement limited to deals/contest surfaces — never in search ranking, comparisons, or TerpBot output.
4. Member supporter tier (cosmetic-free: e.g. higher storage/photos, early features) — compatible with V2 as long as it never buys XP, standing, or unlocks that gate other members.
5. Do **not** sell placement inside TerpBot recommendations or comparison data; do not sell member data.

---

## 13. Build / Don't build / Watch

**BUILD**
- Sitemap pagination + strain/question JSON-LD (cheap, immediate acquisition).
- Promised progression unlocks (env charts, comparison slots, export-at-rank, saved views, templates, reminders, watch rules, cockpit) — restores design invariant.
- Harvest report v2 (plant count, wet/dry, stage durations, seed-to-harvest graph, next-grow transition).
- Curated `Brand`/`Product` catalog with nullable links from updates/diaries/setups; product pages; harvest product reviews (later, with safeguards).
- `Breeder` entity + strain variants + aliases.
- Questions: stage facet + diary/week link; `QAPage` schema.
- Diary discovery facet counts; week rollup view with per-week reactions.
- Sponsored-contest framework (admin-defined, staff-judged mode).
- Mobile foundation: token auth, `/api/v1` DTOs, signed uploads, push abstraction, deep links.
- Native app v1 (scope §8).

**DON'T BUILD**
- Algorithmic short-post feed (Threads clone) — conflicts with quality-first identity and re-creates like incentives; `/feed` + chat already cover live community.
- Short video — cost/moderation profile incompatible with current infra; low fit for evidence-driven journaling.
- Like counts as ranking/leaderboard inputs; "global position" by likes.
- Self-service brand accounts / brand posting in feeds — impersonation and astroturf risk; premature before catalog and moderation capacity.
- Group chats in DMs — rooms already exist.
- Strain family tree — high curation cost, low value at 658 strains.
- Translation layer — out of scope for a deterministic-first, single-language community today.

**WATCH**
- Threads adoption and whether GD's recommendation feed cannibalises diaries.
- GD app install growth (1K+ after ~1 month) — indicates how much native matters for this audience.
- Shorts → whether week-keyed video becomes the default diary medium.
- GD Questions ↔ Threads convergence.
- Brand-page ad-free/buy-button uptake as a signal for catalog monetization viability.

---

## 14. Multi-phase roadmap (dependency-ordered)

**Phase 0 — Foundation (data + API)**
- `Brand`, `Product`, `Breeder` models; nullable FKs; `suggestProductLink`; admin curation; staff-only creation.
- Sitemap pagination; JSON-LD for strains/questions.
- `/api/v1` DTO layer for diaries/updates/notifications/feed; token auth; signed uploads; push subscription model + `notify()` transport abstraction; deep-link table.
- `WatchRule`, `Reminder` models (no UI yet).

**Phase 1 — Competitive parity**
- Harvest report v2 + graph; plant count; next-grow transition.
- Week rollup view + per-week reactions; discovery facet counts; pot size per update.
- Questions stage facet + diary link; solved-first symptom landing pages.
- Breeder pages from entity; strain variants/aliases.
- Product pages (lights/tents/nutrients first) with "grows using this".

**Phase 2 — TerpTalk differentiation (ship the promised unlocks)**
- Env charts (30/90d, day/night), comparison slots + env comparison, export-at-rank, saved views, quick-log templates, reminders, custom facets.
- Grower Cockpit (compose existing member-home, intel, quests, watch).
- Achievements (plan Phase 9) and mentoring/guide/challenge authoring gates.

**Phase 3 — Intelligence**
- Watch rules basic → advanced → compound over the snapshot; BOT_ASSIST cron extension.
- Whole-grow review + historical trends (self-comparison).
- Anonymized experiment/symptom→resolution aggregates (k-anon) feeding TerpBot evidence weights and community-evidence views.
- Feed-chart presets from `Product` (nutrient schedules).

**Phase 4 — Native mobile (iOS + Android)**
- v1 scope (§8) on the Phase 0 API; push; camera uploads; offline-tolerant update POST.

**Phase 5 — Ecosystem**
- Sponsored-contest framework; claimed brand pages with disclosure; harvest product reviews with anti-astroturf rules; affiliate links at product level.

**Phase 6 — Advanced platform**
- Research aggregates for Master Cultivators; cross-member comparison ("grows like mine" across strain × medium × light product); guide authoring by members; possible supporter tier.

---

## 15. Dependency graph

```
Sitemap/JSON-LD ────────────────────────────────► (independent, do first)
Brand/Product/Breeder models ─┬─► Product pages ─► Product reviews ─► Brand ecosystem/contest sponsors
                              ├─► Feed-chart presets (TerpBot)
                              ├─► Env/light comparisons beyond strain
                              └─► "Brands of choice" on profile, g/W on leaderboard
Harvest v2 (plant count, wet/dry, durations) ─► Harvest graph ─► Historical trends ─► Research aggregates
Questions stage+diary link ─► TerpBot /diagnose context ─► Symptom→resolution aggregates ─► Community evidence
WatchRule/Reminder models ─► Watch basic ─► Advanced/compound ─► Cockpit
/api/v1 + token auth + signed uploads + push ─► Native v1 ─► Mobile chat/contests later
Contest framework ─► Sponsored contests ─► Brand pages (claimed)
Promised unlocks (charts, slots, export, templates, saved views) ─► Progression credibility ─► Achievements
```

---

## 16. Testing impact (27-suite architecture preserved)

| Capability | Owning suite | New test needed? | Notes |
|---|---|---|---|
| Sitemap pagination / JSON-LD | `discovery-integration` (+ `ui-contracts` for schema presence) | Extend | Assert caps removed, UNLISTED excluded |
| Brand/Product/Breeder models + suggest-link | `content-edit` (strain linkage lives here), `strain-lifecycle` | Extend | Prune/deletion safety mirrors strain tests |
| Product pages / reviews | `diary` HTTP + `trust-safety` (report type) | Extend | Review eligibility + 0-XP invariant in `reputation` |
| Harvest v2 + graph | `diary` HTTP, `content-edit` parsers | Extend | Yield conversions in existing yield checks |
| Questions stage/diary link | `forum` HTTP, `terpbot-pipeline` | Extend | Visibility leak test in `self-service` |
| Facet counts | `discovery-integration` | Extend | PUBLIC-only counts |
| Promised unlocks (charts/slots/export/templates) | `rewards3` (unlock gates) + `runtime-verify` (403 + unlockId) | Extend | No new suite |
| Watch rules / reminders | `terpbot-decisions` (pure triggers), `terpbot-pipeline` (DB), `notifications` | Extend | Cap logic reuses BOT_ASSIST tests |
| Aggregates (k-anon) | `community-analytics` (slow tier) | Extend | Min-sample assertions |
| Contest framework | `rewards3` + `reputation` (keyed payouts) + `trust-safety` | Extend | Sponsorship never touches ledger — assert in `check-drift` invariants |
| Token auth / `/api/v1` / signed uploads / push | `security` (lib), `runtime-verify` (black-box), `account` (HTTP) | Extend | Revocation on deletion belongs in `account` |
| Native app | **New domain**: one mobile contract suite (API v1 DTO snapshots) | New (justified) | Mobile UI tests live in the app repo, not here |
| Runtime verification | `runtime-prod` | Extend | New headers/CORS for token endpoints |

Rule applied: new behaviour extends the canonical domain suite; the only new permanent suite is the mobile API-contract domain.

---

## 17. Product architecture recommendations

1. Introduce `Brand`, `Product(category, brandId, name, slug, specs Json?)`, `Breeder`; nullable FKs on `DiaryUpdateNutrient`, `GrowDiary` (many-to-many `DiaryProduct{role: LIGHT|TENT|FAN|FILTER|METER|CONTROLLER|SUBSTRATE|NUTRIENT}`), `GrowSetup`, `Strain.breederId`, `StrainVariant(strainId, breederId)`; keep free text as fallback; staff-only creation; member suggestions via existing `Feedback`/report style queue.
2. Harvest: add `plantCount`, `wetWeightG`; treat `yieldAmount` as dry; derive per-plant and g/W; stage durations from timeline.
3. Questions: `Thread.stage String?`, `Thread.diaryId String?`, `Thread.diaryUpdateId String?` (SetNull), PUBLIC/UNLISTED only.
4. `WatchRule(userId, diaryId?, metric, comparator, threshold, windowDays, active)` evaluated by the BOT_ASSIST cron via the snapshot; `Reminder(userId, diaryId?, cadence, nextAt)`.
5. API: `/api/v1/*` handlers returning stable DTOs; token auth (`ApiToken`/refresh) coexisting with cookies; `Upload` via signed Blob URLs + server re-encode job; `PushSubscription(userId, platform, token, revokedAt)`; `notify()` fan-out to in-app + push.
6. Sitemap: split into index + per-entity chunks; remove `take` caps or paginate.
7. Keep the deterministic boundary: catalog data feeds TerpBot only through the validated knowledge registry / snapshot — no free-text product marketing enters evaluation.

---

## 18. Open questions (product decisions)

1. Curated catalog vs member-suggested-with-review: who curates, and how large before product pages go public?
2. Will TerpTalk accept brand relationships at all (claimed pages, sponsors), or stay affiliate-only?
3. Contest judging: staff-picked (GD model) vs community vote — or both by contest type?
4. Weekly cadence nudges: should TerpTalk suggest a weekly rhythm (GD's default) while keeping free cadence?
5. Should harvest product reviews exist, given astroturf risk, or should product "evidence" stay purely aggregate (harvest counts, yields) with no text reviews?
6. Push delivery vendor and whether email becomes an *optional* recovery/notification channel (pseudonymity trade-off).
7. Native app scope confirmation (§8) and platform order (Android first per GD's install pattern, or both via one cross-platform stack).
8. Whether achievements (plan Phase 9) ship before or after the promised functional unlocks.
9. Appetite for any short-form format ("diary moments") vs holding the line.
10. Production content volume — not measured here; needed to size SEO and aggregate min-sample thresholds.

---

## Final answers

**10 most important gaps:** (1) promised unlocks unbuilt; (2) no nutrient/equipment identity; (3) thin harvest report/graph; (4) no push or mobile API; (5) breeder as string / no strain variants; (6) sitemap caps + missing schema; (7) no sponsored/prize contest layer; (8) questions lack stage facet + diary link; (9) no week-level social feedback on diaries; (10) no next-grow transition.

**10 most promising TerpTalk-specific opportunities:** (1) watch rules over the snapshot; (2) whole-grow review + historical self-comparison; (3) k-anon experiment/symptom→resolution evidence feeding TerpBot; (4) env comparison using high-fidelity metrics GD lacks; (5) question↔diary↔diagnosis closed loop; (6) Grower Cockpit; (7) harvest retrospective generated deterministically; (8) feed-chart presets from a curated catalog; (9) pseudonymous, privacy-tiered mobile app; (10) contribution-quality progression made credible by real unlocks.

**Foundations for the next phase:** `DiaryUpdate` metric model + `diary-weeks` timeline; TerpBot snapshot/decisions/BOT_ASSIST pipeline; `hasUnlock` registry; `notify()`; `Report`/moderation stack; `Strain` catalog + `strain-stats` gating pattern; Pusher realtime; Blob upload pipeline; 27-suite gate.

**Should NOT be pursued:** Threads-style algorithmic feed, Shorts/video, like-based rankings, self-service brand accounts, DM group chats, family tree, translation.

**Before native mobile:** Phase 0 API/auth/upload/push foundation; harvest v2; the early promised unlocks (so the app has something to unlock); notification transport abstraction.

**Design now to avoid a rewrite:** token auth beside cookies; `/api/v1` DTOs; signed uploads; `PushSubscription` + transport abstraction; deep-link table; idempotent update POST; device-aware rate-limit keys.

**Most improves structured grow data:** Brand/Product/Breeder identity; harvest v2 fields; pot size per update; stage/diary link on questions; facet counts (which also expose data gaps to fill).

**Most improves deterministic TerpBot:** product identity (dosing evidence), watch rules, question↔diary context, k-anon experiment/symptom aggregates, harvest retrospectives.

**Most improves participation without fake engagement:** shipping promised unlocks; staff-judged sponsored contests with 0 ledger effect; week rollup with reactions (reactions stay 0 XP); mentoring routing; Spotlight/pinned harvest (already).

**Realistic 12–18 months:** Q1: Phase 0 + SEO fixes + harvest v2. Q2: parity (weeks, facets, questions, breeder/product pages) + first promised unlocks (charts, comparison, export). Q3: watch rules, cockpit, achievements; mobile v1 beta on Android. Q4–Q5: iOS, sponsored contests, product reviews with safeguards, aggregates/community evidence. Q6: research aggregates, member guide authoring, supporter tier decision.
