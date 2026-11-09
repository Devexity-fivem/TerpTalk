# TerpTalk UI/UX Redesign — Living Progress Document

**Branch:** `feat/terptalk-ui-ux-redesign`
**Baseline:** `origin/dev` @ `47b6379` (`feat(progression): V3 social economy`)
**Started:** 2026 — progress tracked below. Do not mark an area complete until its interactions and responsive layouts have been verified in a real browser.

---

## 1. Audit findings (Phase 1)

### Existing system — stronger than expected
The app already has a real design foundation ("Verdant Ember" rebrand):
- Tailwind v4 + `@theme` token pipeline, dual light/dark palettes with OS + explicit theme (`data-theme`), WCAG-checked status colors, reduced-motion/reduced-transparency handling, safe-area + iOS-zoom fixes.
- Fonts: Inter (body) + Sora (display) via `next/font`.
- `src/components/ui/` primitives: surface, page-header, tabs, avatar, skeleton, empty-state, toast, tooltip, confirm-dialog, stat-strip, profile-card, tag, time-ago, link-tabs.
- Chrome: sticky top bar (`tt-top-nav`), fixed left rail (lg+, icon→labeled at xl), hamburger drawer (full site map), mobile bottom dock (`mobile-nav.tsx`), persistent chat panel (`ChatPanelInset` shrinks content on lg+, `ChatDock` edge tab + mobile sheet), command palette (⌘K), share composer.
- Pages already share a shell: left rail + main + optional right rail (feed, forum, strains, strain detail).

**Decision:** the token *pipeline* and chrome *architecture* stay — ripping them out is churn without benefit. The redesign targets visual direction (palette, typography, density, surfaces), information architecture, navigation consolidation, and page-level consistency — the actual gaps.

### Confirmed UX problems (screenshots, dev DB @ `ovztvfbvylcdpsuchvps`)
1. **The Stream is too tall** — landing renders a 3-column "TerpTalk Stream" teaser grid that *duplicates* `/feed`, followed by Explore cards, Pulse, Grower-of-Week, Spotlight, CTA: ~4100px of vertical scroll with repeated destinations. Member feed cards are chunky (large padding, tall action rows).
2. **Chat is hard to find** — it lives as one item inside the rail's "Community" group, one of 7 items in the mobile dock, and a low-contrast edge tab. Guest `/chat` is a dead-end sign-in wall. No ambient presence of "the room is alive" anywhere.
3. **Three overlapping navigation maps** — top-bar menu drawer, left rail, and mobile dock each carry different site maps; the landing additionally shows a floating hamburger FAB while app pages show the dock (inconsistent).
4. **Moment detail** renders a narrow card centered on an empty wide canvas — no context column, wasted space.
5. **Sparse-data states** — dev DB is nearly empty; many pages show raw empty regions rather than composed empty states.
6. **Mobile feed** — tier chip collides with the timestamp on narrow widths.
7. **Sign-in/onboarding** — serviceable centered card but generic; doesn't sell the product.

### Route inventory (key areas)
| Area | Routes | Current state | Priority |
|---|---|---|---|
| Landing/Home | `/` (guest landing + `MemberHome` for members) | Long multi-section landing; member feed + composer | High |
| Feed | `/feed` | Composer + filter pills + feed list + right rail | High |
| Forum | `/forum`, `/forum/category/[slug]`, `/forum/thread/[slug]`, `/forum/new`, `/questions`, `/tags` | Category list + right rail; thread detail solid | High |
| Diaries | `/diaries`, `/diaries/[id]`, `/diaries/new`, `/diaries/[id]/edit`, experiments, harvest | Structured but ordinary cards/timeline | High |
| Setups | `/setups`, `/setups/[id]`, `/setups/new`, `/setups/[id]/edit` | List + detail + comments | Medium |
| Strains | `/strains`, `/strains/[slug]`, `/strains/new`, breeder pages | Detail already well-composed | Medium |
| Profiles | `/u/[username]`, `/profile`, `/profile/complete`, `/growers` | Profile V2 w/ presets exists | Medium |
| Moments | `/m/[id]`, `/stories/[username]` | Narrow detail, weak context | Medium |
| Chat | `/chat`, `/messages` | Sheet/panel + sign-in wall for guests | High |
| Notifications | `/notifications` | Auth-gated list | Medium |
| Progression | `/progress`, `/achievements`, `/reputation`, `/leaderboard` | Panels exist | Medium |
| Learn | `/guides`, `/guides/[slug]`, `/plant-doctor`, `/help`, `/rules`, `/calculator`, `/compare`, `/digest`, `/mydigest` | Mixed layouts | Medium |
| Commerce/contest | `/contest`, `/deals`, `/youtubers` | Boards exist | Low |
| Auth/onboarding | `/auth/*`, `/welcome`, `/profile/complete` | Generic centered cards | Medium |
| Settings | `/settings`, `/settings/notifications`, `/settings/blocked` | Forms | Medium |
| Admin/Mod | `/admin/*`, `/moderation/*`, `/staff/*`, `/ops` | Functional | Low |
| Misc | `/about`, `/terms`, `/privacy`, `/maintenance`, `/sitemap*`, `/icon.png` | Static | Low |

---

## 2. Design direction — "Field Journal"

**Concept:** TerpTalk as a grower's field journal — editorial, botanical, calm, premium. Not neon "weed app" and not generic SaaS.

- **Typography:** display face moves from geometric Sora to **Fraunces** (variable serif, high optical range) — instantly editorial/organic; Inter stays for UI/body (still 2 fonts, no perf cost).
- **Palette evolution (same token pipeline, new values):**
  - Light: warmer paper `#f5f3ec` background (vs cool gray-green), warm-white cards, deeper forest primary `#175c3c`, copper accent `#a05a17`, softer sage borders `#dcd9cb`.
  - Dark: near-black canopy `#080d0a`, deep-green card `#111a14`, softened luminous mint `#6fe3ac` (less neon than `#3ef0a8`), warm ember `#f0a958`.
  - Spectrum (pine→iris→ember) kept for signature accents only.
- **Surfaces:** flatter, more confident — fewer nested rounded cards, hairline dividers for lists, one elevation level for interactive surfaces. Radius tightened (lg=0.625, xl=0.875) — less bubbly.
- **Density:** the Stream becomes an editorial list — single-row items, hairline separators, compact thumbs, one-line meta; feed actions inline and quiet until hover.
- **IA:** five destinations — **Home · Community · Grow · Chat · You** — with Discover, Library, and utility inside them. Chat promoted to a first-class destination with an unread "alive" signal.
- **Shell:** slim icon rail (lg+) with labeled groups at xl; top bar simplified to brand · search · create · alerts · account; ONE mobile bottom dock (Home · Community · + · Chat · You) replacing the hamburger-FAB/dock split.
- **Signatures:** serif display numerals for stats, hairline spectrum rule on key surfaces, terracotta "alive" dot for online/chat presence, restrained `tt-lift` hovers.

---

## 3. Milestone tracker

| # | Milestone | Status |
|---|---|---|
| 1 | Audit + direction doc | ✅ done |
| 2 | Foundation: palette/typography/density tokens, font swap | ✅ `b1b6ada` |
| 3 | Shell: chat-first rail, consolidated mobile dock | ✅ `505d912` (top-bar drawer + ChatDock unchanged, still coherent) |
| 4 | Home + Stream density | ✅ partial `505d912` — feed rows + landing rhythm tightened; landing stream still a 3-col teaser (structure TBD) |
| 5 | Forums + thread detail | ✅ `e998c84` — Slice E forum pass, API-fixture verified ×3 viewports |
| 6 | Diaries, setups, strains | ⬜ inherits tokens only |
| 7 | Profiles + moments | 🔸 byline wrap fix `4d891b5`; layouts unchanged |
| 8 | Chat surface, messages, notifications | 🔸 discoverability fixed via nav; surfaces unchanged |
| 9 | Progression, guides, plant-doctor, help, contest, settings, auth | 🔸 contest/settings/welcome done `e998c84`; progression+guides slices in flight |
| 10 | Admin/mod consistency pass | ✅ `e998c84` — token-only normalization, all routes 200 ×3 viewports under staff sessions |
| 11 | Responsive + a11y sweep at 5 viewports | 🔸 1440/1024/390 verified via screenshots (Slice E routes + earlier slices); a11y-specific sweep + remaining routes pending |
| 12 | Verification gate + final report | 🔸 tsc/lint/test:fast(5/5)/build all PASS on `4d891b5` |

### Gates run so far (on `4d891b5`)
- `npx tsc --noEmit` — exit 0
- `npm run lint` — exit 0
- `npm run test:fast` — 5/5 PASS
- `npm run build` — exit 0, all 157 routes compile
- Browser: desktop+mobile screenshots of ~30 routes (dev DB is sparse — mostly empty states)
- Not yet run: `test:master` (full 33-suite gate ~90min) — required before merge review

## 4. Known issues / risks
- Dev DB is nearly empty (test fixtures only) — rich states need seeded fixtures or honest empty-state review.
- `tt-reveal` scroll-timeline sections render blank in static screenshots — use `reducedMotion` emulation for captures.
- Setup fixture is private (404 for guests) — setup detail needs a public fixture.
- Test fixture usernames (`__test_pv2_*`) surface on the landing — data-quality note, not a redesign bug.

---

## 5. Per-route status (Phase 2)

Legend: `NOT STARTED` → `IN PROGRESS` → `IMPLEMENTED` (code done) → `BROWSER VERIFIED` → `COMPLETE` (functionality preserved, interactions tested, desktop+mobile+empty+populated reviewed, no known a11y/visual blocker).

| Route | Status | Notes / evidence |
|---|---|---|
| `/` (landing + member home) | BROWSER VERIFIED | Rhythm `505d912`; Stream → unified editorial strip `1422e65` + mobile clip fix `fc3c773`; shots `p2-d/m-stream` |
| `/feed` | BROWSER VERIFIED | Density `505d912`; verified `p4-d/m-feed` post-redesign |
| `/diaries` | BROWSER VERIFIED | Filters + collapse `162f764`,`6b5c65a`; shots `p2-d/m-diaries*`; populated-card review pending seeded data |
| `/diaries/[id]` | BROWSER VERIFIED | Eyebrow/chips/title `7d2d2c8`; populated journal verified `p4-d/m-diary-detail` (fixture, cleaned) |
| `/diaries/new`, `/diaries/[id]/edit` | IMPLEMENTED | `diary-form.tsx` sectioned (Identity/Env/Schedule/Visibility) `7d2d2c8`; browser check pending |
| `/notifications` | BROWSER VERIFIED | Group-tinted badges, unread contrast `923ecf6` |
| `/chat`, `/messages` + ChatPanel/ChatDock | BROWSER VERIFIED | Day separators, jump pill, grouping, guest wall, mobile sheet `923ecf6`; 36/36 checks |
| `/forum`, thread, category, `/questions`, `/tags` | BROWSER VERIFIED | Slice E `e998c84`: composer shell + shared empty states + tag/hashtag editorial pass; fixture thread+reply created via real `POST /api/forum/threads`+`/api/forum/posts` (`__redesign_ops_*`, cleaned); shots `forum-*-{1440,1024,390}` etc. |
| `/forum/new` composer | BROWSER VERIFIED | Included above — notices conditional, CTA/cancel normalized; payload + gating unchanged |
| `/setups`, `/setups/[id]`, `/setups/new`, `/setups/[id]/edit` | BROWSER VERIFIED | Grouped equipment + at-a-glance `84142f7`; sectioned form `ba25c14`; shots `p3-*-setup*` (full+minimal fixtures, cleaned) |
| `/strains`, `[slug]`, breeder, new, `/compare` | BROWSER VERIFIED | Editorial catalog, facet chips, related strains `9bede73`; 67/67 DOM asserts |
| `/u/[username]`, `/profile`, `/growers`, `/profile/complete` | BROWSER VERIFIED | Hero composition + deep-link tab fix + hub `341f798`; 24 shots `p3-*-prof-*`. SSR verified; hydration re-check after dev-server restart |
| `/m/[id]`, `/stories/[username]` | BROWSER VERIFIED | Author rail + more-from + comment hierarchy `9bede73`; `p3-*-mom-*`, `p3-*-stories-*` |
| `/progress`, `/achievements`, `/reputation`, `/leaderboard` | BROWSER VERIFIED | Slice D `1252f43` — editorial headers/cards, zero logic changes; DOM audit 1440/1024/390 |
| `/guides`, `[slug]`, `/plant-doctor`, `/help`, `/rules`, `/calculator`, `/compare`, `/digest`, `/mydigest` | BROWSER VERIFIED | Slice D `1252f43` — guide discovery + markdown article + knowledge surfaces; fixtures cleaned |
| `/contest`, `/deals`, `/youtubers`, `/welcome` | BROWSER VERIFIED | Slice E `e998c84`: editorial headers, spotlight cards, shared empty states; voting/disclosures/rank gates + onboarding semantics unchanged; 3-viewport shots |
| `/auth/signin`, `/auth/signup` | IMPLEMENTED | Field Journal eyebrow + taglines `b43df4f`; recover/welcome unchanged |
| `/settings*` | BROWSER VERIFIED | Slice E `e998c84`: PageHeader + surface normalization; auth/API/toggle semantics unchanged; shots `settings*-{1440,1024,390}` |
| `/admin/*`, `/moderation/*`, `/staff/*`, `/ops` | BROWSER VERIFIED | Slice E `e998c84`: token-consistency only (tt-spotlight/rounded-2xl/font-display/PageHeader); all 16 admin + 2 moderation routes HTTP 200 ×3 viewports under minted ADMINISTRATOR/MODERATOR JWT sessions; `/ops` redirect intact; no logic/API/gate changes |

## 6. Exact next continuation point
0. **Gate blocker (2026-11-09):** the full `test:master` run failed 2 suites, both on time limits. `product-events`: the dev server wedged after a concurrent `npm run build`; standalone re-run on a fresh server PASS (100.4s). `diary`: 290/290 assertions PASS standalone, but it takes 804s against the 480s cap, with DB round-trip measured at ~200ms/query from this machine. The redesign diff touches no API/lib code. Re-run the full gate when DB latency is normal; do not raise the timeout. Never run `npm run build` against the dev server while tests run.
1. Milestone A remainder: seed a few public diary fixtures (dev DB `ovztvfbvylcdpsuchvps`, unique `__redesign_*` names, clean up after) → screenshot `/diaries` populated + `/diaries/[id]` → polish detail header if needed → diary-form sections pass (`diary-form.tsx`, shared new/edit).
2. Milestone B: `/m/[id]` composition (context rail or intentional single column — decide in browser), `/stories/[username]`, `/strains` browse polish, `/u/[username]` + `/growers` sections.
3. Milestone C: chat surface (conversation list/item, message groups, mobile sheet, `/chat` 28-line wrapper), `/messages`, `/notifications` browser verify.
4. Milestones D–E: progression visuals (`/progress`, `/achievements`, `/reputation`, `/leaderboard` — visual only), learn pages, auth, settings, admin/mod token consistency; then 5-viewport a11y sweep + `test:master` gate.
5. Final: `npm run build` + full gate → final report per §20.

## 6b. Next initiative (after this redesign ships) — TerpBot capability expansion
Sequencing decision: TerpBot work starts **only after** this redesign meets its completion standard (all routes redesigned, browser-verified, full `test:master` green, build green, tracker accurate). **No TerpBot commits on `feat/terptalk-ui-ux-redesign`.**

When started: new branch from the then-approved integration baseline → audit every existing command/event/scheduled task/permission/data path/knowledge source → capability inventory → gap analysis vs. target (structured versioned knowledge engine, deterministic diagnostics, owner-authorized grow-state context, validated calculators, opt-in alert engine, deterministic NL interface, TerpTalk integrations, least-privilege bot identity) → phased architecture + test-fixture plan → independently testable milestones. Hard constraints: no LLMs/generative AI, no invented facts, explainable + auditable outputs, no external APIs without approval, never expose another member's private/unlisted data, no moderation/DM/security powers, keep working commands until migration requirements exist.

## 7. Screenshot evidence index
All under `C:/Users/pablo/AppData/Local/Temp/audit-shots/` — `v2-*` (post-foundation), `p2-*` (post-filters), `new-*` (palette check). Use `reducedMotion:"reduce"` for full-page captures (tt-reveal).
