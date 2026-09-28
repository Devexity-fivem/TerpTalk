# Profile V2 & Full UI/UX Audit

**Type:** read-only design/audit. No code, schema, migrations, seeds, tests, APIs, TerpBot, cron, or data touched.
**Baseline:** `progression-v2 @ 8b6d609` (verified — still current HEAD; nothing landed since the roadmap reconciliation).
**Method:** full source inspection. Device/viewport behavior is assessed from code (breakpoints, markup); the dev DB is suspended until Oct 1 so nothing was exercised live — findings are code-grounded, flagged where runtime verification is still needed.
**Companion docs:** `terptalk-vs-growdiaries-audit.md`, `terptalk-roadmap-reconciliation.md` (unlock-integrity findings this audit builds on).

---

## 1. Executive summary

1. **The profile is a competent v1 but architecturally thin for what it should become.** It already has: identity fields, rank chip + XP progress, pinned harvest, most-grown strains, harvest shelf, setups, grows, discussions, badges, grow streak, progression history, a TerpBot variant, and correct privacy plumbing (blocks → 404, banned → 404/noindex, visibility scoping, milestone opt-out). What it lacks is the *grower identity* layer: **the five mastery paths and build title are never rendered anywhere** — not on the public profile, not even on the owner's `/progress`. `MasteryProgress` is write-only data.
2. **Two load-time problems compound each other:** the public page is a client fetch after a thin SSR shell (every view = skeleton → fetch → paint), and the API handler runs ~9 **sequential** queries then serves `no-store`. The biggest cheap win in this entire audit is server-rendering the payload and parallelizing those queries.
3. **Standing is transported but never displayed** (`standing` in payload, `trustLevel` legacy field also in payload — both dead). The card API already has the right pattern (`standingDisplay` → named chip). Profiles should show the named tier at ≥Known and nothing below.
4. **Customization is near-zero today**: bio capped at **150 chars** (`BIO_MAX`), no banner, no sections, no layout control, `favoriteStrain`/`growExperience`/`growSpace` are free text, "featured grow" is staff/system-managed (`featured` is never user-editable — profile falls back to first active grow). "Fully customizable" is almost entirely new surface.
5. **The cosmetics tension is real but navigable.** The user killed cosmetic *rewards*; this task asks for rich customization. The reconciliation resolution: customization is a **member feature for everyone**, progression unlocks only *functional* extras (more sections, more stat slots, featured rotation) — never pure vanity. Rank nameplates still linger (carry-over open decision).
6. **Site-wide, the design system is better than expected**: shared `ContentCard`, `EmptyState`, `TierChip`, `UserPopover` + `/card` DTO, `ui/` primitives, full light/dark token system. The gaps are consistency (three tab idioms, mixed card recipes, native `confirm()`, dead payload fields, four progression vocabularies) — systemic fixes, not rebuilds.
7. **A compact-profile-card language already exists** (`UserPopover` + session cache + compact DTO with standing chip). Profile V2 should standardize around it rather than invent another.

---

## 2. Current profile inventory (verified)

### 2.1 Surfaces and data sources

| Surface | File / route | Current behavior | Privacy scope | Customization | Verdict |
|---|---|---|---|---|---|
| Public profile page | `u/[username]/page.tsx` | SSR resolves profile ID for 404 only; renders client shell | banned/suspended → 404 + noindex | none | THIN SHELL |
| Profile client | `u/[username]/profile-client.tsx` | Fetches `/api/users/[u]`; header card, 8-stat grid, streak, pinned harvest, strains, badges, 4 tabs (Overview/Grows/Discussions/Achievements), featured/current grow, progression history, harvest shelf, setups, grows; TerpBot variant w/ botStats | honors visibility + blocks | none | PARTIAL |
| Public API | `api/users/[username]/route.ts` | ~9 sequential queries; safe fields; https-only URLs; PUBLIC diary scoping; opt-out aware | strong | — | ENHANCE (perf + content) |
| Card API | `api/users/[username]/card/route.ts` | compact DTO: rank chip, `standingDisplay` named tier, badges, grow counts, `statusHidden` | strong | — | KEEP — model for DTO layer |
| Member card popover | `components/user-popover.tsx` | hover (250ms)/tap card; session cache; links to profile | respects hideOnlineStatus | — | KEEP/ENHANCE |
| Own profile | `app/profile/page.tsx` | tabs Profile/Progress/Saved/Account; edit form (photo, bio 150, location, website, growExperience select, growSpace, favoriteStrain, business), pinned-harvest picker (unlock-gated), badge pinning (slots perk), export, delete | owner | low | PARTIAL |
| Own profile API | `api/profile/route.ts` | PATCH validates fields + pinnedDiary gate + showcase slots | owner | — | ENHANCE |
| Chat author | `chat-room.tsx` + `chatAuthorSelect` | nameplate-classed username, avatar, role | statusHidden | nameplate (rank-derived) | KEEP |
| Thread author | `forum/thread/[slug]` | avatar, nameplate, TierChip, badges row | public | — | KEEP |
| Card/selects | `security.ts` `publicUserSelect` | shared author select; still selects frozen `reputation` | — | — | ENHANCE (drop dead field) |
| Leaderboards | `leaderboard`, `/growers`, `/leaderboard/yields` | XP/standing boards + grower directory tabs + yield table | public | — | KEEP |
| Search/growers result | `search-results.tsx` | author rows w/ TierChip | public | — | KEEP |
| Progression history | profile + `PUBLIC_XP_TYPES`/`publicXpLabel` | safe labels, opt-out aware | strong | — | KEEP |
| Export | `api/profile/export` | full-account JSON, all members | owner | — | KEEP |
| Follow lists | — | counts only; **no followers/following pages** | — | — | MISSING |

### 2.2 Per-component gap notes

- **Stats grid**: XP, Threads, Posts, Followers, Following, Diaries, Harvests, Updates — all raw counts; no accepted answers, mastery, experiments, or longest-grow. Counts are `_count` subqueries (scales fine).
- **Most-grown strains**: computed client-side from the ≤12 diary rows shipped — correct visibility scoping, small sample.
- **Featured/current grow**: `diary.featured` (system-managed — members can't set it) else first active grow. No "featured" picker for active grows (pinned-harvest picker exists only for harvested).
- **Standing**: payload sends raw `standing` + legacy `trustLevel`; client renders neither. Card API already solves display correctly.
- **Progression block**: xpStage "Grow Level" + stage name + rank + benefit + recent events — decent, but no path/mastery surface and no unlock roadmap for the visitor.
- **Business block**: business fields render publicly — check moderation/policy intent (they're opt-in, fine; flag for review workflow, not a leak).
- **`isOwner` distinction**: same payload for owner and visitor except diary scope — the owner has no richer private view on this surface (private stats don't exist anywhere).

---

## 3. Profile V2 product definition

The profile = **a customizable digital grower identity + community portfolio**, answering in seconds: who this grower is, what they grow, how experienced they are, what they specialize in (mastery), what they're growing now, what they've finished, what they know, and what they chose to share.

Non-goals: a popularity scoreboard, a badge wall, a clone of any social profile. Standing is trust display, not a score.

---

## 4. Profile information architecture

```
HERO (always, ~above fold)
├─ Banner (optional, member-set image — new)
├─ Avatar + nameplate username + RoleBadge + Bot chip
├─ Rank chip + Grow Level + named standing chip (≥Known only)
├─ Build title line — "Grower Who Keeps Notes" (new — data exists today)
├─ Grower identity line: experience · space · styles · mediums (user-authored, select-based)
├─ Member since · location (opt-in) · website (https) · pronouns (opt-in)
├─ Current grow card (live stage + day + last update — visibility-scoped)  ← WOW
└─ Actions: Follow / Message (dmPolicy) / Report / Block
ROW 1 — NOTABLE STATS (curated strip, user-selectable, ≤8)               ← WOW
ROW 2 — MASTERY MAP: 5 paths with level + XP + dominant paths highlighted ← WOW
TABS (member-reorderable): Overview · Grows · Harvests · Contributions · About(+custom)
  Overview: featured grow, recent activity, notable stats, setup summary
  Grows: active + all diaries (visibility-scoped)
  Harvests: portfolio cards (pinned first)
  Contributions: accepted answers, guides, experiments, discussions, setups
  About: bio (raised cap), custom sections, equipment/nutrients, philosophy
SECONDARY: badges/achievements, progression history (opt-out), TerpBot insight (owner only)
```

Section ordering, visibility, and which stats/widgets show are member-controlled (Part 11 model).

---

## 5. Grower identity model

| Field | Source | Control |
|---|---|---|
| Experience level | user select (`EXPERIENCE_LEVELS` — exists) | public default, hideable |
| Grow space | user select (Indoor/Outdoor/Greenhouse/Mixed — currently free text; upgrade to enum + "Other") | hideable |
| Mediums/styles | user multi-select (soil, coco, hydro, DWC, living soil; LST, SCROG, topping, SOG…) | hideable |
| Preferred light types | derived from diary headers (top-2 by count, PUBLIC diaries) | derived — label "Typically runs" |
| Most-grown strains | derived (exists client-side; move server-side over full scoped set) | derived |
| Favorite strain | user-authored (exists, free text → link to canonical strain when matched) | hideable |
| Grow goals / philosophy | user-authored custom section | per-section privacy |

Rule: derived items only ever aggregate over data the viewer can already see (PUBLIC for guests/members, all for owner). Never infer location, age, or anything sensitive.

---

## 6. Progression integration

- **Hero shows**: rank chip + name, Grow Level N, stage name, XP progress to next stage (exists), **build title** (exists in config, never rendered — free win).
- **Standing**: named chip via `standingDisplay` at ≥Known (25); renders nothing at New Face — don't shame zero. Tooltip: "earned through accepted answers and community trust." No numeric score, no progress bar — it's judgment, not grind.
- **Mastery map**: five path chips with M-level + share bars; dominant path(s) highlighted; deterministic, hybrid-friendly (matches `buildTitle` logic).
- **Recent progression**: exists — keep, opt-out aware.
- **Unlocks**: visitor sees *notable earned capabilities* only if we frame them as "capabilities" not "rewards" — e.g. "Keeps 3 grow watches". Owner sees full roadmap on `/progress` (already); profile shows the title-level summary. Defer granular unlock display — low visitor value.
- **Achievements**: schema-only today (reconciliation finding) — profile integrates when Phase 9/achievements ship; until then badges tab stays legacy.

---

## 7. Five mastery paths — display design

Per path chip: icon + plain name + `M{level}` + thin XP bar + share-of-total tint. Dominant ≥70% → "Specialist" tag; hybrid → the `buildTitle` pair title shows in hero. **No invented archetypes** — titles come straight from `buildTitle`'s existing table ("Grower Who Keeps Notes", "Helpful Regular", "All-Rounder"…). Visitor learn-in-2-seconds: "this person mainly helps + documents."

⚠ Dependency flagged: `EXPERIMENTATION` earns 0 XP today (dead path — reconciliation). The mastery map would expose a permanently-zero path on every profile. **Fix the EXPERIMENT_* wiring (Phase I of the reconciliation roadmap) before or with the mastery map**, or the profile's showcase feature embarrasses itself.

---

## 8. Notable TerpTalk data model

Derived stats — all computable from existing rows; classification: **A** automatic (always eligible), **S** user-selectable (owner picks ≤8 shown), **P** owner-private, **H** never public.

| Stat | Derivation | Class | Privacy note |
|---|---|---|---|
| Grows documented | diary count (scoped) | A/S | PUBLIC count for visitors |
| Harvests completed | harvested count (scoped) | A/S | |
| Updates logged | update count (scoped diaries) | S | |
| Detailed updates | count where quality band ≥RICH (from ledger `UPDATE_RICH/EXCEPTIONAL`) | S | real "documenter" signal |
| Longest grow | max(end−start) scoped | S | |
| First grow / growing since | min(startDate) | S | |
| Mastery levels | MasteryProgress | A (map) | |
| Accepted answers | thread acceptedAnswer count | A/S | genuine contribution |
| Guides published | Guide count (when member authoring ships) | S | |
| Experiments run/completed | GrowExperiment counts | S | after Phase I wiring |
| Contest wins | contest win rows | S | |
| Check-in / grow streak | streaks (opt-out aware) | S | opt-out → hidden |
| Setup showcases | setup count | S | |
| Referrals | qualified count | P | vanity-ish; owner only |
| Exact yields per harvest | diary fields | S per-harvest — default ON but individually hideable | quantity sensitivity |
| Typical env ranges (avg temp/RH band) | aggregate scoped updates | P default → opt-in S | never per-diary leak |
| Standing internals, XP event detail, flags | — | H | staff/owner only |

**Card rule**: one line each — `12 grows documented` · `7 harvests` · `Knowledge M3` · `Longest grow: 126 days`. No "favorite"/"best" language without explicit user choice.

---

## 9. Active grow & featured grow

- **Active grow card** (hero): title, strain, stage chip, day N, last-update date + latest photo thumb, env one-liner (latest temp/RH only if diary PUBLIC), update count. Scoped: PUBLIC for visitors; owner sees UNLISTED/PRIVATE own rows with a small "only you see this" marker.
- **Featured grow**: new member choice — `Profile.featuredDiaryId` (any own diary the viewer can see, not just harvested; separate from `pinnedDiaryId`). Picker lists own diaries; render respects visibility per-viewer; `featured` system flag stays for staff/homepage use.
- **Featured items beyond grows**: featured harvest = existing pinned harvest (keep — don't duplicate); featured setup/experiment/guide = same pattern later (`featuredSetupId`…), low priority.

---

## 10. Customization model

```
Profile.profileSettings JSON (or ProfileSection model + settings JSON):
{
  bannerImage: url|null,           // Blob upload, same pipeline as avatar
  accent: "pine"|"amber"|"violet"|"slate"|"ember",   // preset token sets, not arbitrary hex
  density: "cozy"|"compact",
  sections: [ {id, order, visible} ],                // reorderable IA blocks
  shownStats: ["harvests","acceptedAnswers",…],      // ≤8 from Part 8
  customSections: [ {id, title, body(markdown), order, visibility} ],  // ≤N by tier
  identityFields: { experience, space, mediums[], styles[], favoriteStrainId|text }
}
```

- **No arbitrary HTML/JS** — custom sections are sanitized markdown via the existing composer renderer; embeds limited to the existing YouTube/Vimeo whitelist.
- **Themes**: preset bundles of the above controls (Grow Journal / Botanical / Grow Room Dark / Data / Community) — a theme is a *preset*, not a separate skin. Coherence + accessibility preserved; dark/light stays system-level (theme-toggle exists).
- **Banner**: one image slot, server re-encode like avatars; decorative — doesn't gate content.
- **Raised `BIO_MAX`** 150 → ~500 (bio) + custom sections carry longer content.

### Free vs progression-earned (Part 42)

| Free at Seed | Earned extras (functional, not vanity) |
|---|---|
| avatar, banner (1), accent presets, theme presets, all core sections, bio, ≤2 custom sections, identity fields, featured grow, ≤4 shown stats | +custom sections (Rooted 4 → Cured 8), +stat slots (→8), featured rotation (2→4 pinned items), "records" widget (longest/biggest/oldest), profile analytics for owner |

Never re-gate anything already free (vacuous-unlock lesson).

---

## 11. Custom sections spec

`ProfileCustomSection { profileId, title(≤60), body(markdown ≤2000), order, visibility, createdAt, updatedAt }` — CRUD via `/api/profile/sections`, moderation inherits `Report.type` + content limits; sanitized markdown only; images via existing uploader (≤N each); exported in data export; cascade-deleted on account deletion; block/visibility honored; collapse on mobile to accordions.

Suggested starter titles the UI offers (not required): About My Grow · My Setup · Growing Philosophy · What I'm Testing · Favorite Genetics · Lessons Learned · Goals.

---

## 12. Equipment & strain integration (catalog-ready)

- **Now**: free-text "My setup" custom section + setups list (exists).
- **Integration point**: `ProfileEquipment { profileId, productId?, label, role }` — write `label` always; `productId` when catalog exists (Part 7 of reconciliation). Renders as chips today, links to Product pages later. Same pattern for `favoriteStrain` → `strainId?` fallback text. **Profile V2 must be built label-first so the catalog slots in without redesign.**
- Strain portfolio: grown strains (scoped, top N + "see all"), repeat counts, links to strain pages; favorite = user-designated only.

---

## 13. Harvest portfolio

Harvest shelf → portfolio cards: photo, title, strain, days, yield (hideable per-harvest), rating shown, "featured" pin order. New controls: hide-yield toggle per harvest; reorder via featured picks (≤3). Deepens with Harvest Report V2 (reconciliation Phase III) — per-plant/wet-dry appear when those fields ship.

---

## 14. Community contribution section

Not a leaderboard — a *what-they-give* block: accepted answers (count + 3 recent linked), guides, experiments shared, setups, contest wins, mentoring (when that pipeline exists). Each links to the actual content. Deliberately excludes likes/reactions — consistent with the no-fake-engagement economy.

---

## 15. Follow/social UX

Today: follow/unfollow + counts only; no follower/following lists anywhere (not even owner view); DM respects `dmPolicy`. Recommendation: add **paginated followers/following lists** (members-visible, block-filtered) — high-value for a community platform, low farm-risk since nothing ranks by followers. Keep counts modest on cards. Open decision flagged.

---

## 16. Privacy builder

Per-section visibility: **Public / Members only / Hidden** (3 levels — "Followers" level rejected: extra complexity, marginal gain, and follower lists are public anyway). Defaults: identity/stats/grows/public-content = Public; exact yields = Public but per-item hideable; env aggregates = Members-only default; progression history = public unless `publicMilestoneOptOut`.

Cross-cutting invariants (all enforced server-side):
- Blocked → 404 (exists) extends to every new section.
- UNLISTED diaries never appear in lists/stats/strains derived for others (exists — keep the scoped-aggregation rule for every new derived stat).
- Aggregates (env ranges, most-grown) only ever compute over viewer-visible rows.
- Sitemap/metadata unchanged — profile JSON-LD shows only Public-level fields.
- Export includes everything the owner set, including hidden sections.
- `unlockFrozen` behavior unchanged.

---

## 17. Profile discovery

Deterministic, explainable only: growers directory (exists — XP board + tabs) gains **mastery filters** ("Showing growers with Helping Out M3+") and "currently growing" filter once mastery reads exist; strain pages already link growers via diaries; search returns profile cards (exists). No algorithmic feed. `/growers` + leaderboard merge is a candidate consolidation (see roadmap — two overlapping surfaces).

---

## 18. Profile cards everywhere — mini grower card spec

Standardize on `UserPopover` + `/card` DTO as the single card contract: avatar, username (nameplate), role, rank chip, **standing chip**, build title *(add)*, one selected stat *(add — owner-chosen)*, current-grow indicator *(add)*, badges (exists), harvested/total grows (exists). Consume it in: chat, threads, comments, diary pages, search, questions, leaderboards, contest boards, notification actors, mentions. **Do not add**: follower counts, standing numbers, env data — compact stays compact.

---

## 19. Full UI audit (all surfaces)

Priority classes: **P0** correctness/security/privacy · **P1** major usability/product · **P2** meaningful improvement · **P3** polish.

| Area | Evidence | Findings | Priority |
|---|---|---|---|
| Navigation | `navigation.tsx`, `mobile-nav.tsx` | sticky glass nav, xl full links / md search pill / mobile drawer; ⌘K command palette; notif+msg badges. Generally strong. Watch: many icon-only controls rely on Tooltip for labels (aria-labels present on some — audit each icon button). | P2 |
| Homepage | `(home)/page.tsx` | hero + Stream + explore + CTA + Spotlight + GotW. Guest/member split exists. Dense page — hero is huge; member-home is a different surface entirely. | P2 (hero density) |
| Forums | forum index, category, thread, tags | ContentCard lists, related discussions, accepted answer, polls, nameplates. Composer is solid (poll composer, images, tags w/ cap). | KEEP |
| Diaries index | `diaries/(index)` | filters + community stats band + cards. Good. | KEEP |
| Diary detail | `diaries/[id]/page.tsx` | richest page: timeline, week groups, env/height charts (recharts), harvest report, intel panel (owner), comparison rows (all viewers), experiments, discussion link. **Perf flag**: recharts + full update set render server+client — check bundle/lazy-loading; page is long. | ENHANCE (perf, week rollup per roadmap) |
| Diary update form | `update-form.tsx` | 17 metrics — dense but complete. | KEEP |
| Strains | index + `[id]` + breeder | 658 catalog, filters, characteristics/genetics/growing info, photos, grow stats. Breeder pages are string-grouped (catalog gap — known). | ENHANCE (JSON-LD, variants later) |
| Questions | `questions/page.tsx` | unanswered/solved tabs, tags shown; **no stage facet, no diary link** (reconciliation confirmed). | ENHANCE |
| Plant Doctor | wizard → tagged thread | deterministic, good loop. | KEEP |
| Search | `search` + suggest | 7-entity unified search + saved searches (cap 50 all). | KEEP |
| Chat | `chat-room.tsx`, rooms | rich: commands, presence, gated rooms, slowmode, popovers. Mobile chat unverified at runtime. | KEEP (verify mobile) |
| Progress | `progress/page.tsx` | quests, challenges, journey, streak, rank path, unlock roadmap, standing. **Missing: mastery map, build title.** | ENHANCE (P1 — showcase the write-only system) |
| Reputation/explain | `reputation/page.tsx` | "how it works" — renamed concepts but URL stays `/reputation` (fine, aliases exist). Watch stale `GUIDE_PUBLISHED` earn-list entry (dead event — P0-adjacent copy bug). | ENHANCE |
| Leaderboard/growers | both pages | XP weekly board + standing + yields + growers directory — **overlapping surfaces** (3 "top growers" idioms). | ENHANCE (consolidate) |
| Contest | `contest/page.tsx` | Budshot + diary contest boards. | KEEP |
| Notifications | `notifications/page.tsx` | grouped, category tabs, prefs per type. | KEEP |
| Settings/notifications | settings pages | 9 notify toggles + privacy toggles (online status, milestone opt-out, dmPolicy, blocked list). Clean. | KEEP — add profile-privacy section here |
| Messages | `messages/page.tsx` | DM inbox. | KEEP |
| Auth | signin/signup/recover/onboarding | Turnstile, recovery phrase, onboarding stepper. Pre-existing Tailwind shorthand warnings only. | KEEP |
| Help/Rules/Privacy/Terms/About | static pages | clear, consistent. | KEEP |
| Deals | `deals` + `/go/` | gated tiers working. | KEEP |
| Admin/staff | admin/*, moderation/* | functional staff tools; not user-facing polish targets. | KEEP (out of scope) |
| Profile | §2 | the subject of this doc | REDESIGN |

## 20. Systemic UX findings

1. **Four progression vocabularies coexist**: "Grow Level" (rung index), stage name ("Foxtailing"), rank ("Ripening"), mastery level (M1–M10, hidden). Visitors can't build a mental model. → one hierarchy presented everywhere: Rank > stage-within-rank > (Grow Level optional tooltip); mastery labeled "path level." **P1**
2. **Three tab idioms**: custom button tabs (profile), `SegmentedControl` prim, overflow tab bars (questions/notifications). → one `Tabs` primitive. **P2**
3. **Mixed card recipes**: `ContentCard` adopted on feeds/discover/search but profile harvest/grow cards, diary cards, setup cards are still bespoke. **P2**
4. **Native `confirm()`** for block (and possibly other destructive actions) — replace with styled `AlertDialog` primitive (missing). **P2**
5. **Dead payload fields**: `trustLevel`, `standing` (public profile), `reputation` (publicUserSelect). **P3** (P0-adjacent hygiene — stale legacy vocabulary in API contracts)
6. **Empty states inconsistent**: shared `EmptyState` in 16 files but many spots still raw `<p>No X yet</p>`. **P3**
7. **`<img>` with eslint-disable** vs next/image — pervasive (Blob URLs). Verify sizing/lazy attrs are consistent; consider allowing next/image remote patterns for Blob host. **P2 (perf)**
8. **Dense 8-col stat grids** repeated (profile, bot). → stat-strip primitive, 4 + expandable. **P2**
9. **Loading states**: profile client-fetch skeleton is good; many server pages stream fine; some API-backed panels show nothing on failure (fetch `.catch` → silent). Standardize error/empty. **P2**
10. **Mastery invisible** (write-only) — biggest single discoverability hole. **P1**
11. **Dead earn-list entries** (`GUIDE_PUBLISHED` on /reputation + dead events) — copy lies. **P1** (integrity, per reconciliation)
12. **Inconsistent uppercase-section-label pattern** vs h2 — minor. **P3**

## 21. Design-system audit

| Status | Items |
|---|---|
| Solid prims | `ContentCard` (compact/media), `Avatar`, `Badge/tt-badge`, `Tooltip/InfoTip`, `Skeleton`, `EmptyState`, `SegmentedControl`, `Toast`, `TimeAgo`, `Surface`, `ActivityItem`, `TierChip`, `RoleBadge`, `AchievementBadge`, `UserPopover` |
| Missing prims | `Tabs` (unified), `StatStrip`, `AlertDialog/ConfirmDialog`, `SectionCard` (the `tt-spotlight`/`bg-card` recipe repeated ~50×), `Tag/Chip` standalone, `MetricBar` (for mastery map), `PageHeader` (h1+sub+actions recipe repeated everywhere) |
| Tokens | full light/dark set incl. `--np-*` nameplate palette, `tt-*` recipes (spectrum-bar, spotlight, lift, edge-card, nameplate-*) |
| Inconsistencies | border/opacity recipe variants (`border-border/70` vs `/40` vs none); heading scale drift (`text-lg` vs `font-semibold` mixed); some pages skip `font-display` |
| Recommendation | extract `PageHeader`, `SectionCard`, `Tabs`, `StatStrip`, `ConfirmDialog` first — they pay back across every roadmap item |

## 22. Mobile audit (code-level; runtime verify post-Oct-1)

- Nav: proper breakpoint ladder (mobile drawer → md search pill → xl full links). Watch header crowding at 360px when signed in (avatar+msg+notif+theme+search icons). **Verify live.**
- Profile: `grid-cols-3` at 320px for 8 stats = cramped; tab bar `overflow-x-auto` good; header `flex-wrap` handles wrap; pinned-harvest/business blocks fine. → StatStrip fixes.
- Diary page: long page + charts; recharts at 320px needs min-height guards (verify); week nav exists (`week-navigator`).
- Tables: yield leaderboard/admin tables — check horizontal scroll wrappers; growers/leaderboards use overflow-x on tab bars already.
- Composer: markdown composer on mobile — target-size check on toolbar buttons (~44px) — verify.
- Chat: popover on touch = first-tap-open (deliberate, good); message input + Pusher fine; gated-room denial copy wraps.

## 23. Accessibility audit

- Present: `role="tablist"`+`aria-selected` on tabs, `aria-label` on icon buttons in many places, `sr-only` loading status, `focus-visible:ring` on interactive rows, `aria-labelledby` on edit form, semantic h1/h2, `prefers-reduced-motion` blocks in nameplate CSS.
- Gaps: `role=tab` buttons lack `aria-controls`/panel linkage and **arrow-key navigation** (APG tabs pattern) — applies to all three tab idioms; `UserPopover` keyboard open exists but focus-management on close (return focus) unverified; `confirm()` is a11y-poor and unmodal-styled; nameplate gradient usernames — check WCAG contrast for leaf/bloom on dark (gradient ends are themed; verify); `<img>` alt often `alt=""` on meaningful avatars/thumbs (empty alt okay for decorative; setup thumbs arguably meaningful); dynamic list updates (Pusher chat) — no `aria-live` region (check chat-room); form errors are text-only (add `aria-invalid`+`describedby` pass).

## 24. Performance audit

| Path | Issue | Cost | Fix |
|---|---|---|---|
| `/u/[u]` | client fetch waterfall: SSR shell → skeleton → fetch → ~9 sequential awaits → `no-store` | every view pays ~10 RTT-serial queries + double paint | assemble in RSC (parallel `Promise.all`), server-render; keep `/api` for popover freshness only |
| `getPublicProfileData` | sequential awaits (threads→streak→diaries→setups→harvest→count→pin) | ~7 serial roundtrips | Promise.all — all independent |
| `/u/[u]` freshness | `no-store` whole payload | re-fetches everything | acceptable for correctness; cache the static-ish profile block 60–300s keyed by user (badges/lists change rarely) |
| Diary page | recharts + all updates + intel + compare server-side | heavy page | lazy-load charts (`next/dynamic`), paginate/stream updates, verify |
| Popover | module cache good | — | extend TTL memo (session-level fine) |
| `getGrowStreak` | per-view computation | scan per profile view | cache or store counters |
| Images | raw `<img>` + data-URI source ≤300KB | okay-ish | standardize loading/decoding attrs; consider next/image remote config |
| publicUserSelect | pulls frozen `reputation` for ~85 consumers | tiny but ×85 | drop field |

## 25. DTO architecture

```
PublicProfileDTO   — viewer-scoped: identity(visible), rank/stage/buildTitle, standingChip,
                     masteryMap, shownStats(scoped), heroGrow(scoped), featured(scoped),
                     sections[Public-visible], harvests(scoped, yield flags), setups, contribution
OwnerProfileDTO    — Public + private stats, all sections, draft state, privacy preview
ProfileCardDTO     — exists; +buildTitle +one selected stat +activeGrow indicator
ChatAuthorDTO      — exists (chatAuthorSelect) — keep lean
SearchProfileDTO   — avatar/username/rank/one-liner
StaffDTO           — everything + flags/ledger internals (staff surfaces only)
```

Rules: server boundary applies visibility per-section before serialization; blocks → 404 before DTO assembly; no field leaves unless a component renders it (kill `trustLevel`, raw `standing`, `reputation`).

## 26. Profile performance contract

- Initial payload: hero + stats + mastery + featured + top-6-of-each section = ~8 parallel queries (bounded selects, no relations beyond counts).
- Below-fold sections lazy/tab-fetched (`/api/users/[u]/sections/{grows,harvests,contributions}` paged, `cursor` based).
- Derived stats: computed per-request initially (all `_count`/aggregate queries); add cached `ProfileStats` JSON refreshed on write or nightly only if profiling proves it needed — don't pre-cache.
- Hard caps: badges ≤50 rendered (paginate rest), sections ≤10, stats ≤8 shown, strains top 10 (+link), no full update history ever.

## 27. TerpBot integration

**Owner-only block** on own profile/About tab: "Your grower snapshot" — deterministic lines like *"Most of your XP comes from Helping Out (M3)"*, *"4 updates logged this grow — richest week: 6"*, *"Next: Ripening needs Helping Out M2"* (diversity-floor aware — genuinely useful), *"2 grows had attention flags you never marked resolved."* Clearly labeled "from your logged data — only you see this". **Nothing TerpBot-generated renders to visitors** beyond already-public derived facts. Zero private-data egress; the insight block reads the same snapshot TerpBot already builds — no new data collection.

## 28. SEO

Public-level profile fields only in metadata/JSON-LD (`ProfilePage` type): username, bio, avatar, join date, rank name. Never: standing internals, hidden sections, UNLISTED/PRIVATE data, env aggregates, stats marked members-only. Keep banned/suspended → 404/noindex (exists). Profiles stay sitemap-capped modestly (thin member pages are low-value — per reconciliation).

## 29. Data lifecycle

| Event | Behavior |
|---|---|
| Export | all profileSettings, sections (incl. hidden), stats, privacy choices |
| Account deletion | sections/settings cascade; derived stats recompute elsewhere; reversal outboxes already handle XP |
| Diary → UNLISTED/PRIVATE/delete | instantly disappears from all derived stats/featured for non-owners (scoped aggregation, no cached leaks) |
| Block | 404 whole profile incl. sections/cards (exists; extend to new DTOs) |
| Opt-out (`publicMilestoneOptOut`) | hides streak + progression history + spotlight eligibility (exists); extend to "recent activity" derived stats |
| Badge pin/unpin | slot perk already enforced |

## 30. WOW moments (verifiable builds)

1. **Mastery map** — five paths visible with levels + build title (data exists today; write-only → visible).
2. **Hero "currently growing"** with live stage + day + last photo.
3. **Notable-stats strip** — deterministic one-liners a visitor parses in 3 seconds.
4. **Harvest portfolio** — pinned-first cards with photos + duration + rating.
5. **Owner "grower snapshot"** — TerpBot-style deterministic self-insight (diversity-floor-aware next-step).
6. **Featured grow + custom sections** — the profile feels *authored*, not generated.

## 31. Profile V2 roadmap

| Phase | Contents | Depends on |
|---|---|---|
| **P0 Data/DTO** | `Profile.featuredDiaryId`, `ProfileCustomSection` model, `profileSettings` JSON; DTO layer; parallelize+SSR public page; drop dead fields | none — schema work first |
| **P1 Core profile** | hero (banner, build title, standing chip), mastery map, notable stats strip, featured grow, harvest portfolio v1, contribution block | P0 + EXPERIMENT_* wiring for Experimentation path honesty |
| **P2 Customization** | section ordering/visibility, accent/theme presets, custom sections CRUD, raised bio, identity selects | P0 |
| **P3 Portfolio & social** | strain portfolio, equipment chips (label-first), followers/following lists, per-harvest yield hiding | P1 |
| **P4 Cards & discovery** | card DTO v2 (build title + stat + grow indicator), mastery filters on /growers, leaderboard consolidation | P1 |
| **P5 Owner intelligence** | TerpBot snapshot block, private stats | P1 + snapshot |

## 32. Global UI roadmap

| Phase | Contents |
|---|---|
| **U0 Primitives** | `PageHeader`, `SectionCard`, `Tabs` (APG), `StatStrip`, `ConfirmDialog`, `Tag` |
| **U1 Integrity** | kill dead payload fields + dead earn-list copy; unify progression vocabulary labels |
| **U2 Perf** | profile SSR+parallel (with P0), diary chart lazy-load, sweep `next/image` decision |
| **U3 Consistency** | migrate bespoke cards→ContentCard, tabs→Tabs, confirm()→ConfirmDialog, text empties→EmptyState |
| **U4 Page-level** | header crowding pass @360px, diary page length/lazy sections, leaderboard/growers merge, error-state sweep |

## 33. Build / Redesign / Keep / Remove / Defer

| Area | Verdict | Reason |
|---|---|---|
| Public profile page | **REDESIGN** | thin shell + missing identity layer |
| Profile API | **ENHANCE** | correct & safe; sequential queries + dead fields + no mastery |
| Card/popover system | **KEEP+ENHANCE** | already the right contract; add 3 fields |
| Own profile settings | **ENHANCE** | works; becomes the customization surface |
| Progression display | **REDESIGN** | mastery write-only; vocabulary sprawl |
| Harvest shelf | **ENHANCE** | exists; becomes portfolio w/ controls |
| Setups/strains on profile | **ENHANCE** | lists exist; needs portfolio + catalog-ready fields |
| Featured grow | **REPLACE** | system flag → member choice (`featuredDiaryId`) |
| Nameplates | **KEEP (decide)** | rank-derived display (open decision carried from reconciliation) |
| Followers/following pages | **BUILD** | counts exist, lists don't |
| Env/diary charts | **KEEP** | already shipped; lazy-load |
| Growers+leaderboards | **ENHANCE (merge)** | 3 overlapping surfaces |
| `confirm()` dialogs | **REPLACE** | AlertDialog primitive |
| Custom themes | **BUILD (presets)** | preset bundles, not skins (open decision) |
| Freeform HTML embeds | **DO NOT BUILD** | markdown only, ever |
| Follower-ranking surfaces | **DO NOT BUILD** | farm-bait |
| TerpBot public profile content | **DO NOT BUILD** | owner-only insights |

## 34. Open product decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Themes — presets vs free color? | **Presets** (token-safe, a11y-safe); never arbitrary hex |
| 2 | Custom sections — freeform vs predefined? | **Freeform title + markdown body** with suggested titles; ≤N by tier |
| 3 | Default grow-data publicity? | Current model (diary visibility governs); stats aggregate viewer-visible only |
| 4 | Notable stats user-selectable? | **Yes** — owner picks ≤8 from the derived set; auto-fill defaults |
| 5 | Exact yields public? | Public by default (already public on harvest shelf), **per-harvest hide toggle** |
| 6 | Env summaries on profile? | Members-only aggregate (typical range), opt-in to public; never per-diary |
| 7 | Full strain history public? | Scoped-visible, top-N + "see all" |
| 8 | Layout reordering? | **Yes** — section order array; hero always first |
| 9 | Widget hiding? | Yes, all non-hero widgets toggleable |
| 10 | Multiple layouts? | **No** — one layout, reorderable. Layout variants add DB+complexity for no user need |
| 11 | Customization via progression unlocks? | **Functional extras only** (sections/stats/featured counts), never visual vanity — per the no-cosmetics directive |
| 12 | Featured rotation? | Defer — one featured + pinned harvest enough now |
| 13 | Followers/following public lists? | **Yes, build** — community discovery outweighs farm-risk (nothing ranks by it) |
| 14 | Nameplate keep/drop (carried over)? | **Keep** — rank display not equippable cosmetic; pending user confirm |
| 15 | Display name separate from username? | **No** — pseudonymous username is identity; avoids impersonation surface |
| 16 | Pronouns field? | Optional, free-text ≤20, default hidden — low cost, real inclusivity value |

## 35. Profile success criteria

- Visitor in ≤5s: who they are, specialty (build title/paths), what they're growing, experience level, accomplishments, contributions.
- Owner: personalize identity, control per-section visibility, feature work, reorder, understand progression incl. paths.
- System: zero private leaks through aggregates, zero fake metrics, no popularity ranking, <1s TTI for hero, works 320px→1440px, APG-consistent, deterministic derived data only.

---

# FINAL REPORT

## Profile V2 findings
Strong privacy/plumbing foundation; correct rank/XP/badges/shelf basics; but **mastery is completely invisible** (write-only), no customization beyond 6 free-text fields, featured grow isn't member-controlled, standing is fetched but never shown, and the page pays a client waterfall of ~9 sequential queries per view.

## Profile V2 design
Hero (banner, avatar, nameplate, rank+level+standing chip+build title, identity line, current-grow card, actions) → notable-stat strip (≤8 user-selected derived) → mastery map → tabbed portfolio (Overview/Grows/Harvests/Contributions/About+custom) → secondary (badges, history, owner TerpBot insight). Customization = settings JSON (section order, accent preset, theme preset, stat picks, custom markdown sections) — presets not skins, functional-not-vanity progression extras.

## Notable TerpTalk data
Derived-only catalog in Part 8 (counts, streaks, mastery, accepted answers, experiments, longest grow, env bands) with Public/Members/Hidden classes; per-harvest yield hiding; never standing internals.

## Progression integration
Rank+stage+XP in hero; named standing chip ≥Known (no numbers); mastery map + build title finally rendered; achievements when engine ships. **Prereq: EXPERIMENTATION wiring or the map shows a dead path on every profile.**

## Privacy
3-level per-section (Public/Members/Hidden) + existing block→404, diary scoping, opt-outs; aggregates compute only over viewer-visible rows; Public-only reaches SEO.

## Global UI findings
Good bones (ContentCard, popover+DTO, tokens, 22 solid components). Systemic issues: progression vocabulary sprawl, 3 tab idioms, bespoke cards, `confirm()`, dead payload fields, inconsistent empties, native `<img>`s, dense stat grids.

## Design system
Build first: `PageHeader`, `SectionCard`, `Tabs` (APG), `StatStrip`, `ConfirmDialog`, `Tag` — everything else composes from these.

## Mobile
Code-level OK (breakpoint ladder, overflow tabs, wrap headers); watch: 3-col stat grid @320px, nav crowding when signed in, chart min-heights — runtime-verify post-reset.

## Accessibility
Decent base; gaps: tab keyboard nav + `aria-controls`, confirm() replacement, `aria-live` for chat, form `aria-invalid`/describedby, nameplate contrast verification, alt-text audit on meaningful thumbs.

## Performance
Biggest wins: server-render profile + `Promise.all` the ~9 queries (currently sequential + `no-store`), lazy-load diary charts, drop dead select fields ×85 consumers.

## Build/Redesign/Keep/Remove/Defer
§33 — Redesign: public profile, progression display. Replace: featured grow (member-controlled), confirm(). Build: followers lists, custom sections, presets, stat system. Do-not-build: freeform embeds, follower rankings, TerpBot public content, multiple layouts.

## Roadmaps
Profile: P0 data/DTO → P1 core profile → P2 customization → P3 portfolio/social → P4 cards/discovery → P5 owner intelligence. Global: U0 primitives → U1 integrity → U2 perf → U3 consistency → U4 page-level. Profile P0+U0+U2 share work — do them as one batch.

## Open decisions
§34 — 16 items; headline: presets-not-skins, freeform markdown sections, user-selected stats, yields public-but-hideable, followers lists yes, one reorderable layout, functional-only progression extras, nameplate keep.

## Final recommendation
Execute as first batch: **U0 primitives + Profile P0** (`featuredDiaryId` + `ProfileCustomSection` + `profileSettings` JSON + DTO layer + SSR/parallelize the public page + drop dead fields) — then **P1 core profile** (hero + mastery map + stats strip + featured grow). Sequence note: EXPERIMENT_* wiring (reconciliation Phase I) should land before or alongside the mastery map so no profile displays a permanently-dead path.

---

# DESIGN-LOCK ADDENDUM (second pass — supersedes open items above)

**Verified:** HEAD still `8b6d609`; design-doc standing tiers (Unknown 0 → Known 25 → Trusted 100 → Respected 300 → Pillar 800 → Elder 1,500), `buildTitle`/`standingDisplay`/`MASTERY_LEVELS` confirmed in `progression-config.ts`; `getPublicProfileData` confirmed sequential-await, `no-store`, rendered behind a client fetch in `u/[username]/page.tsx`.

**Resolution of §34's sixteen decisions** — locked in `profile-v2-implementation-plan.md` §19: presets-not-skins (1), freeform markdown sections (2), diary-visibility governs (3), selectable stats ≤4/≤8 (4), yields public + per-harvest hide (5), env aggregates Members-only default (6), strain top-10+see-all (7), section reordering yes (8), widget hiding yes (9), single layout (10), functional-only progression extras (11), featured rotation deferred (12), follower lists **build, members-visible** (13 — owner confirm), nameplates **keep, rank-derived** (14 — owner confirm), no display name (15), optional pronouns (16).

**Experimentation dependency — locked:** Option A (reconciliation Phase I wires `EXPERIMENT_*` before Profile P1) + Option B as a permanent `pathLive()` gate so no path — now or future — renders an earned M-level while it cannot earn.

**Deliverables produced by the lock pass:**
- `profile-v2-implementation-plan.md` — locked IA, hero, mastery map, standing, stats classes, featured grow, customization limits, free-vs-earned split, 15-widget spec, DTO contracts, perf contract, privacy matrix, lifecycle, progression dependency matrix, P0–P5 phases.
- `global-ui-implementation-plan.md` — locked U0 primitive foundation (PageHeader/SectionCard/Tabs/StatStrip/ConfirmDialog/ProfileCard), vocabulary lock + migration map, per-surface classification table, mobile/a11y/perf requirements, U0–U5 phases.

Nothing above §35 changes as evidence; the addendum resolves what the audit left open.
