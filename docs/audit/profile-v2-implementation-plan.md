# Profile V2 — Locked Design & Implementation Plan

**Status:** design-locked, awaiting owner approval. No implementation.
**Baseline:** `progression-v2 @ 8b6d609` (re-verified this pass — still HEAD).
**Evidence:** `profile-v2-and-ui-ux-audit.md` (primary), `progression-v2-design.md` (Rev 4), `progression-v2-implementation-plan.md`, `terptalk-roadmap-reconciliation.md`.

---

## 1. Product definition (locked)

A Profile V2 is a **customizable digital grower identity and community portfolio**. Within seconds a visitor should learn: who this member is, what they grow, what they're experienced/specialized in, what they've documented and accomplished, what they're currently growing, what they contribute, and what they deliberately chose to share.

Not a résumé. Not a social profile. Not a badge wall. Derived facts beat self-description wherever both exist.

## 2. Locked information architecture

```
┌───────────────────────────── HERO (always first, not reorderable) ─────────────┐
│ Banner (optional, member image)                                                │
│ Avatar · nameplate username · RoleBadge · Verified/Progression-Verified chip   │
│ "Member since …" · location (opt-in) · website (https) · pronouns (opt-in)     │
│ Bio (≤500 chars)                                                               │
│ Identity line: experience · space · mediums · styles (member-authored selects) │
│ Progression row: Rank chip · Grow Level + stage · Build title · Standing chip  │
│ Notable-stat strip: ≤4 member-selected one-liners                              │
│ Active grow card: strain · stage · day N · last update · photo thumb           │
│ Actions: Follow · Message (dmPolicy) · Report · Block                          │
└────────────────────────────────────────────────────────────────────────────────┘
TAB BAR (deep-linkable): Overview · Grows · Harvests · Contributions · About
  Overview    — featured grow card, expanded stats grid, recent public activity,
                mastery map, one pinned custom section
  Grows       — active grows then completed diaries (viewer-scoped)
  Harvests    — portfolio: pinned harvest first, cards w/ photo/duration/rating/
                yield-per-harvest-visibility
  Contributions — accepted answers (+3 recent), guides, experiments, setups,
                contest wins, discussions — links to real content
  About       — full bio, grower identity detail, equipment (label chips),
                custom sections, owner-only "grower snapshot"
SECONDARY BLOCKS (within tabs, collapsible):
  badges/achievements, progression history (opt-out aware), detailed stats
```

**Placement locked:** mastery map + expanded stats live on **Overview** (not hero — hero carries the ≤4-strip only). Strains = inside Grows tab as "Strain portfolio" block. Setups = inside Contributions. Achievements/badges = inside Contributions. About = all member-authored content. Nothing else renders above the fold.

Mobile: hero collapses to avatar + name + rank + build title + 2 stats + active-grow chip; tabs become an overflow-scrolling bar; custom sections render as accordions.

## 3. Profile hero (locked)

| Element | Behavior |
|---|---|
| Banner | Optional member-uploaded image via the existing Blob/re-encode pipeline; decorative (`alt=""`), fixed 16:5 crop, dark/light-safe overlay gradient |
| Avatar | Existing; unchanged |
| Username | Rank-derived nameplate (kept — see decisions) + RoleBadge |
| Display name | **None** — pseudonymous username is the identity (decision D15) |
| Bio | Raised to `BIO_MAX = 500`; plain text + linkified https |
| Rank | `rankDisplay` chip — "Ripening" etc. |
| Grow Level | Sub-level + stage name in one phrase: "Grow Level 12 · Foxtailing" |
| Build title | `buildTitle(paths)` — e.g. "Grow Mentor" — rendered only when total path XP ≥ 50 (below that, omit) |
| Standing chip | Named tier via `standingDisplay`, shown **only at ≥ Known (25)**; below → nothing rendered (no "Unknown" label — no shame badge). Tooltip: "Earned through accepted answers and community trust." No number, no bar. |
| Stat strip | ≤4 member-selected notable stats (default auto-set when unconfigured) |
| Active grow | Card or compact chip; viewer-scoped (public sees PUBLIC only; owner sees own with "only you" marker) |
| Verification | Existing Legacy/Progression Verified chip with distinguishing tooltip (design §9.6) |
| Actions | Follow/Following, Message if `dmPolicy` allows, overflow: Report, Block |

## 4. Mastery Map (locked)

Five path chips in a fixed order — Growing, Journaling, Helping Out, Experiments, Community — each showing: icon, plain name, `M{0–10}` level, XP-to-next-level micro-bar, and a share-of-path-XP tint. Dominant ≥70% gets a "Focus" tag; hybrids get the `buildTitle` pair title in the hero.

**No invented archetypes** — all labels are `MASTERY_META` names or `buildTitle` output. Hybrid and generalist members read correctly by construction.

### Experimentation state (locked — Option A + B)

- **Option A is the plan**: reconciliation Phase I (wire `EXPERIMENT_*` award callsites) ships **before** Profile V2 P1. The path is live by the time the map renders.
- **Option B is the permanent defensive state**: any path with no live earn pipeline renders as "Coming online" — name + icon + muted chip, **no M-level, no bar, no zero**. Detection is config-level (`pathLive()` checks the XP_TABLE family has award callsites / a live flag set at build of that phase), not per-user XP. The map must never display "Experiments M0" as a member's earned state while the path cannot earn.
- The same `pathLive()` gate protects any future dead path.

## 5. Standing (locked)

| Audience | Sees |
|---|---|
| Visitor | Named tier chip **only if ≥ Known (25)**; nothing below |
| Owner (own profile) | Same chip + on `/progress` the existing number/next-tier context |
| Staff | Full number + ledger via staff surfaces (unchanged) |

Locked: no numeric score, no progress bar, no rank table visible to visitors. Standing never appears as a currency. Abuse-detection internals (caps, clusters, flags) never leave staff surfaces. Keep visually distinct from XP — chip, not meter.

## 6. Notable-stats system (locked)

Three classes: **Auto** (always eligible to display), **Select** (member picks ≤4 hero / ≤8 total, default auto-fill), **Owner** (private), **Never** (internal).

| Stat | Source | Calc | Class | Update |
|---|---|---|---|---|
| Grows documented | GrowDiary | `_count`, viewer-scoped visibility | Auto/Select | per-request aggregate |
| Harvests completed | GrowDiary harvested | `_count` scoped | Auto/Select | same |
| Updates logged | DiaryUpdate | `_count` over scoped diaries | Select | same |
| Detailed updates | ProgressionEvent | count `UPDATE_RICH/EXCEPTIONAL` | Select | same |
| Documented weeks | DiaryUpdate | distinct week count scoped | Select | same |
| Longest grow | GrowDiary | max end−start, scoped | Select | same |
| Growing since | GrowDiary | min startDate | Select | same |
| Accepted answers | Thread acceptedAnswer | `_count` | Auto/Select | same |
| Guides published | Guide | `_count` (post-member-authoring) | Select | same |
| Experiments run/completed | GrowExperiment | `_count` | Select | same |
| Strains grown | scoped diaries | distinct strainId | Select | same |
| Current grows | scoped active diaries | `_count` | Select | same |
| Check-in streak | streak lib | exists; opt-out aware | Select | cached |
| Setup showcases | GrowSetup | `_count` | Select | same |
| Contest wins | contest rows | `_count` | Select | same |
| Yield numbers | per-harvest field | shown on card, individually hideable | Select-per-item | same |
| Typical env range | scoped update aggregates | avg band (Members-only default, opt-in Public) | Select | same |
| Referrals | referral fields | count | Owner | — |
| Standing internals, XP event detail, flags | — | — | Never | — |

Rules: every stat computes only over rows the viewer can see; no "favorite"/"best" without explicit member choice; deletion recomputes (no cached leaks); nothing cached in v1 — all `_count`/aggregate queries under the performance contract (§9).

## 7. Featured grow (locked)

- **New field `Profile.featuredDiaryId`** — explicitly member-selected, any own diary. Do **not** overload `GrowDiary.featured` (system/staff-managed for homepage surfaces — keep separate).
- Selection: picker on own-profile editor + "Feature on profile" action on own diary pages. One slot. Replacement = pick another; removal = clear.
- Deletion: `featuredDiaryId` → `onDelete: SetNull`, then fallback render.
- Privacy: renders only if the viewer can see that diary; otherwise falls back to the hero's active-grow card (first active viewer-visible diary); nothing renders if neither exists.
- **Multiple featured items: rejected** — one featured grow + the existing `pinnedDiaryId` harvest are already two curated slots; more adds complexity without evidence. (Deferred, can revisit.)

## 8. Customization model (locked)

`Profile.profileSettings` JSON:
```json
{
  "bannerImage": "url|null",
  "accent": "pine|amber|violet|slate|ember",
  "theme": "default|journal|botanical|growroom|data",
  "density": "cozy|compact",
  "sectionOrder": ["stats","featured","grows","harvests","contributions","badges","history"],
  "hiddenSections": [],
  "shownStats": ["harvests","acceptedAnswers","longestGrow","updatesLogged"],
  "pinnedSection": "sectionId|null",
  "identity": { "mediums": [], "styles": [], "goals": "" }
}
```

`ProfileCustomSection` model: `{ profileId, title≤60, body≤2000 markdown, order, visibility: public|members|hidden, createdAt, updatedAt }` — CRUD at `/api/profile/sections`, cascade on account deletion, included in export, renders via the existing sanitized markdown path; embeds limited to the current approved whitelist; images via existing uploader (≤4/section).

**Hard prohibitions (locked):** no arbitrary HTML, no JS, no custom CSS, no iframe embeds outside the whitelist, no external resource injection. Accents/themes are token presets only — never arbitrary hex. Dark/light remains system-level.

## 9. Free vs progression-enabled (locked)

| Free at Seed (base is already rich) | Progression-enabled (functional extras only) |
|---|---|
| avatar, banner, all accents, all theme presets, bio 500, identity selects, featured grow, stat strip (4), ≤2 custom sections, full section ordering, all core widgets | +custom sections: Rooted→4, Harvested→6, Cured→8 · stat slots 4→6 (Vegged) →8 (Harvested) · "Records" widget (longest/biggest/oldest — Harvested) · owner profile analytics (Cured) |

Locked: nothing already free becomes gated; no visual/vanity items are ever progression rewards (no-cosmetics directive preserved — these are capacity/content extras registered in `UNLOCKS` as functional unlocks with real enforcement at build time).

## 10. Widget system (locked)

Widgets are declarative config — `{ widget, order, visibility }` in `sectionOrder`/`hiddenSections`; no widget executes member code.

| Widget | Source | Default | Privacy | Mobile | Cost | Gate |
|---|---|---|---|---|---|---|
| Mastery Map | MasteryProgress + buildTitle | on | public (paths; live-gated) | 5-chip grid → 2-col | tiny | — |
| Notable Stats | §6 aggregates | on | per-stat class | 2×2 grid | ~5 `_count`s | slots by tier |
| Current/Active Grow | scoped diaries | on | viewer-scoped | full-width card | 1 query | — |
| Featured Grow | featuredDiaryId | on | viewer-scoped + fallback | full-width | 1 query | — |
| Harvest Portfolio | harvested diaries | on (tab) | per-harvest yield flag | horizontal scroll | 1 paged query | — |
| Recent Grow Activity | scoped updates | on | scoped | list | 1 query | — |
| Strain Portfolio | scoped diaries→strains | on | scoped, top-10 + link | chip wrap | 1 group-by | — |
| Setups | GrowSetup | on | public | cards | 1 query | — |
| Community Contribution | answers/guides/experiments/contests | on | public content only | stacked | ~3 `_count`s | — |
| Achievements | UserAchievement | on when engine ships | public | chips | 1 query | Phase IV engine |
| Badges | existing | on | public | chips | exists | — |
| Goals | `identity.goals` | off | per-section | text | 0 | — |
| Custom Sections | ProfileCustomSection | off | per-section | accordion | exists | count by tier |
| Records | aggregates | off | owner-selected | stat cards | aggregates | Harvested |
| Owner Snapshot | TerpBot snapshot | on (owner) | **owner-only** | panel | exists | — |

## 11. DTO architecture (locked)

| DTO | Contents | Consumers |
|---|---|---|
| `PublicProfileDTO` | visible identity, rank/stage/buildTitle, standingChip(≥Known), live mastery map, selected stats (scoped), heroGrow + featured (scoped), per-section visibility-filtered content, per-harvest yield flags | `/u/[u]` SSR |
| `OwnerProfileDTO` | + private stats, all sections, profileSettings, draft/preview | `/profile`, owner view of `/u/[u]` |
| `ProfileCardDTO` | avatar, username+nameplate, role, rank chip, standing chip, buildTitle, 1 selected stat, active-grow indicator, badges, grow counts | `UserPopover` everywhere — extend existing `/card` route, don't fork |
| `ChatAuthorDTO` | existing `chatAuthorSelect` — keep lean | chat |
| `SearchProfileDTO` | avatar, username, rank, one-line identity | search/growers |
| `StaffProfileDTO` | everything + flags/ledger internals | staff only |

Locked rules: visibility applied at the server boundary per section before serialization; block → 404 before DTO assembly; a field ships only if a component renders it (drop `trustLevel`, raw `standing`, `reputation` from public selects); one `getPublicProfileData` in `src/lib/` shared by page RSC and API route.

## 12. Performance architecture (locked)

**SSR**: hero + identity + progression + stats + featured/active + section visibility map — assembled in the page RSC via shared `getPublicProfileData`, rendered server-side; the `/api/users/[u]` route remains only for popover/refresh needs.

**Parallelize**: the ~7 independent queries in `getPublicProfileData` (threads, diaries, setups, harvests, counts, pin, streak) become one `Promise.all` — all are independent today.

**Deferred/paginated**: Grows/Harvests/Contributions tab lists — cursor-paged (`/api/users/[u]/sections/{grows|harvests|contributions}`), never in the initial payload.

**Cached**: profile metadata lookup (existing `unstable_cache` — keep); derived stats computed per-request (aggregates only); consider a 60–300s `s-maxage` on the public DTO keyed by user — verify correctness vs. privacy first, opt-in not default. `getGrowStreak` already cached.

**Never**: all-history payloads, N+1 per-badge/strain fetches, sequential awaits, client-first profile render.

**Contract**: hero interactive <1s on typical account; initial payload bounded (~8 queries); accounts with 10k posts/1k updates same cost as new accounts (counts, not rows).

## 13. Privacy (locked)

Three levels per section: **Public · Members · Hidden** ("Followers" tier rejected — marginal gain, real complexity).

| Section | Default | Notes |
|---|---|---|
| Identity (name/avatar/role/join) | Public | core of the page |
| Location/website/pronouns | member-set, hideable | opt-in fields |
| Progression (rank/level/build) | Public | identity-bearing |
| Standing chip | Public (≥Known only) | never number |
| Mastery map | Public | dead-path gated |
| Notable stats | per-stat class | env = Members default |
| Active/featured grow | viewer-scoped | PUBLIC for visitors |
| Harvests | Public | per-harvest yield hide |
| Strains/setups/contributions | Public | links to public content only |
| Achievements/badges | Public | — |
| Custom sections | per-section | Public default, choosable |
| Progression history | Public unless milestone opt-out | existing behavior kept |

Cross-cutting (all server-side): block → 404 on every section + DTO + card; UNLISTED/PRIVATE never enter visitor-visible aggregates; Public-level only reaches metadata/JSON-LD (`ProfilePage` type); export includes hidden content for owner; `unlockFrozen` untouched; banned/suspended → 404+noindex (existing).

## 14. Discovery (locked — deterministic only)

`/growers` gains mastery filters ("Helping Out M3+", "currently growing"); strain pages continue linking growers via scoped diaries; search returns `SearchProfileDTO` cards. No algorithmic feed, no popularity ordering anywhere.

## 15. Mini grower cards (locked)

One contract, extended not forked: `UserPopover` + `/api/users/[u]/card` (session-cached). Add to card: buildTitle, one member-selected stat, active-grow dot. Consumed by: threads, posts/comments, chat, diary pages, search, questions, accepted answers, challenges/contests, notifications, leaderboards. Compact inline form = avatar + nameplate + rank chip (existing). Mobile: tap-opens card (existing behavior). Excluded forever: follower counts, standing numbers, env data.

## 16. Data lifecycle (locked)

| Event | Behavior |
|---|---|
| Diary delete / →UNLISTED/PRIVATE | instantly absent from scoped aggregates + featured fallback; `featuredDiaryId` SetNull |
| Harvest delete | portfolio card gone; pinned clears |
| Account deletion | sections/settings cascade; derived stats recompute |
| Privacy change | immediate — aggregates recompute per-request, nothing cached to leak |
| Block | 404 whole profile incl. sections/cards |
| Export | all settings + sections incl. hidden + privacy choices |
| Progression reversal | existing outbox; mastery/stat numbers recompute |
| Badge pin | slot perk enforced (existing) |

## 17. TerpBot integration (design only — NOT in P0–P4)

Owner-only "Grower snapshot" block on About tab: deterministic lines from the existing snapshot — dominant path + next milestone (diversity-floor-aware: "Ripening needs Helping Out M2"), documentation cadence, unresolved attention flags. Labeled "from your logged data — only you see this." **Nothing TerpBot-generated renders to visitors**; zero new data collection. Phase P5.

## 18. Progression-integration dependency matrix (locked)

| Profile feature | Requires | Capability status | Phase |
|---|---|---|---|
| Build title | `buildTitle` + MasteryProgress | ✅ data exists today | P1 |
| Mastery map (4 live paths) | MasteryProgress | ✅ write-only now, renders fine | P1 |
| Mastery map (Experiments) | `EXPERIMENT_*` callsites | ❌ dead — **Phase I reconciliation first** | P1 gated |
| Standing chip | `standingDisplay` | ✅ exists, card-proven | P1 |
| Notable stats | `_count` aggregates + ledger bands | ✅ | P1 |
| Detailed-updates stat | `UPDATE_RICH/EXCEPTIONAL` events | ✅ emitted | P1 |
| Accepted-answers stat | acceptedAnswer | ✅ | P1 |
| Experiments stats | GrowExperiment rows | ✅ rows exist | P1 |
| Featured grow | `featuredDiaryId` | new field | P0 |
| Custom sections | `ProfileCustomSection` | new model | P0/P2 |
| Stat/section slot tiers | new `UNLOCKS` entries + `hasUnlock` | new unlocks — register + enforce | P2 |
| Achievements widget | achievement engine writers | ❌ zero writers | Phase IV |
| Records widget | aggregates | ✅ | P2 (Harvested gate) |
| Owner snapshot | existing snapshot lib | ✅ | P5 |

Invariant enforced: **no profile UI advertises a progression feature whose capability doesn't exist** — every gated widget checks `pathLive()`/`hasUnlock` capability, not just registry presence.

## 19. Locked decisions (resolves audit §34's 16)

| # | Decision | Lock | Rationale |
|---|---|---|---|
| 1 | Themes | **Presets only** (5 named) | token/a11y-safe; arbitrary CSS prohibited |
| 2 | Custom sections | **Freeform markdown** (title+body, suggested titles) | real customization within sanitize boundary |
| 3 | Default grow publicity | **diary visibility governs** | existing model, no new semantics |
| 4 | Notable stats selectable | **Yes — ≤4 hero / ≤8 total**, auto-fill default | member-authored identity |
| 5 | Exact yields | **Public default + per-harvest hide** | already public on shelf; adds control not exposure |
| 6 | Env summaries | **Members-only aggregate**, opt-in Public | prevents facility-pattern leakage |
| 7 | Strain history | **Scoped top-10 + see-all** | bounded, useful |
| 8 | Layout reordering | **Yes — section order array**; hero fixed first | core customization ask |
| 9 | Widget hiding | **Yes** — all non-hero | symmetric with ordering |
| 10 | Multiple layouts | **No — one reorderable** | complexity without evidence |
| 11 | Progression extras | **Functional only** (slots/sections/analytics) | no-cosmetics directive |
| 12 | Featured rotation | **Defer** — one featured + pinned harvest | sufficient curation surface |
| 13 | Follower/following lists | **Build, members-visible, block-filtered** | community discovery; nothing ranks by it ⚠ owner confirm |
| 14 | Nameplates | **Keep — rank-derived** | deterministic display, not equippable cosmetic ⚠ owner confirm |
| 15 | Display name | **No** | pseudonymity + impersonation surface |
| 16 | Pronouns | **Yes — optional ≤20 chars, default hidden** | low cost, real value |

## 20. Implementation roadmap (locked)

| Phase | Contents | Depends on |
|---|---|---|
| **P0 Foundation** | `featuredDiaryId` + `ProfileCustomSection` + `profileSettings` JSON migrations; shared `getPublicProfileData` in lib; SSR the public page; `Promise.all` the queries; DTO layer; drop dead fields (`trustLevel`, raw `standing`, `reputation` select); `/api/users/[u]/sections/*` paged routes | — |
| **P1 Core profile** | hero (banner, build title, standing chip, identity line), stat strip + stats engine, mastery map (live-gated), featured-grow picker + render, contribution block, per-section visibility (3 levels) | P0 + **reconciliation Phase I** (Experiments live) |
| **P2 Customization** | banner/accents/themes/density, section ordering + hiding, custom-section CRUD, bio→500, identity selects, new slot unlocks + gates | P0–P1 |
| **P3 Portfolio** | harvest portfolio (pinned-first, yield flags), strain portfolio, equipment chips (label-first, catalog-ready `strainId?`/`productId?`), follower/following lists | P1 |
| **P4 Cards & discovery** | `ProfileCardDTO` extension (title/stat/grow-dot), mastery filters on /growers, consume card across all surfaces | P1 |
| **P5 Owner intelligence** | TerpBot snapshot block, owner-private stats view | P1 + existing snapshot |

**Cross-plan ordering note:** reconciliation Phase I (Experiments wiring, dead-event cleanup, vacuous-unlock resolution) is the only hard external dependency and precedes P1. P0 itself has zero progression dependencies.

## 21. Success criteria (locked)

- Visitor ≤5s: identity, specialty (build title + map), current grow, experience, accomplishments, contributions — all from real data.
- Owner: full identity customization, per-section visibility, featured work, section ordering, progression understanding including paths.
- System: zero private-data leakage through aggregates, zero fake metrics, no popularity ranking, hero <1s regardless of account size, 320px→1440px, APG-consistent controls, deterministic derived data only.

## 22. Design invariants (locked)

1. Profile V2 is valuable at Rank 1.
2. Progression enhances; it never gates basic identity.
3. Derived stats are deterministic and auditable.
4. Private data never becomes public through aggregates.
5. Standing stays distinct from XP — named tier, never a number, to visitors.
6. Experimentation never renders as an earned path while its pipeline is dead (`pathLive()` gate).
7. No arbitrary executable content, ever.
8. Performance is independent of account-history size.
9. Compact surfaces share one DTO/component contract.
10. Reusable systemic solutions over bespoke page fixes.
11. Mobile and accessibility are first-class.
12. No vanity/popularity systems introduced.
