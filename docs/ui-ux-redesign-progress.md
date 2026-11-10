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
| 12 | Verification gate + final report | ✅ all routes BROWSER VERIFIED; tsc/lint/test:fast(5/5)/build PASS on `64598a0`; test:master 29/32 (3 env timeouts, all assertions ✓) |

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
| `/diaries/new`, `/diaries/[id]/edit` | BROWSER VERIFIED | `diary-form.tsx` sectioned (Identity/Env/Schedule/Visibility) `7d2d2c8`; DOM+shots `final-{d,m}-diary-{new,edit}` — all sections, fields bound, no overflow |
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
| `/auth/signin`, `/auth/signup` | BROWSER VERIFIED | Field Journal eyebrow + taglines `b43df4f`; shots `final-{d,m}-auth-{signin,signup}`; login flow exercised by every HTTP suite |
| `/settings*` | BROWSER VERIFIED | Slice E `e998c84`: PageHeader + surface normalization; auth/API/toggle semantics unchanged; shots `settings*-{1440,1024,390}` |
| `/admin/*`, `/moderation/*`, `/staff/*`, `/ops` | BROWSER VERIFIED | Slice E `e998c84`: token-consistency only (tt-spotlight/rounded-2xl/font-display/PageHeader); all 16 admin + 2 moderation routes HTTP 200 ×3 viewports under minted ADMINISTRATOR/MODERATOR JWT sessions; `/ops` redirect intact; no logic/API/gate changes |

## 6. Exact next continuation point
0. **Gate status (2026-11-09, final tree `64598a0`):** `test:master` ran to completion — **29/32 PASS**. The 3 failures are wrapper timeouts with every assertion green: `diary` (480s cap, ~290 checks all ✓), `runtime-verify` (720s cap, all ✓), `browser` (300s cap, all ✓). Cause: dev DB is the remote Supabase pooler (aws-0-us-east-1) at ~270ms/query from this machine — suites are wall-clock-bound, not assertion-bound. Standalone suite runs (no wrapper cap) are the arbiter — see §8. `runtime-prod-verify` PASS. Do NOT raise caps without maintainer review; re-run `test:master` on a faster DB link for a clean gate.
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

## 8. Release-gate evidence (2026-11-09, final tree `8c9205e`)

**`npm run test:master`: 32/32 PASS — Overall: PASS** (~23 min wall-clock). Production-mode verification (`runtime-prod-verify`: real `next build` + `next start` + header/CSP/cookie/fail-closed checks) PASS inside the run.

### How the gate was run
The dev Supabase pooler could not host the gate from this machine: transaction mode (`:6543`, the `.env` default) costs ~200–280ms/query WAN, and session mode (`:5432`, `DATABASE_URL_UNPOOLED`) is ~52ms/query but caps at 15 clients — dev server + suite + prod-verify server exceeded it (EMAXCONNSESSION flakes). The gate therefore ran against a **temporary claimable Neon Postgres** (`steep-forest-16513711`, aws-us-east-2, ~25ms/query, unclaimed/72h expiry): `prisma migrate deploy` (all migrations) + `prisma/seed.ts` + `seed-strains.cjs` (658 catalog strains — required by strain-lifecycle's FORCE_NULL guard checks). Dev server and suites ran with `DATABASE_URL=<neon>` + `DB_GUARD_EXTRA_HOSTS=neon.tech` — the guard's sanctioned ad-hoc-target path; no assertions changed for the environment. Same code, same schema, same seed data path as dev.

### Test-suite optimizations committed (`8c9205e`)
The three formerly-timing-out suites were strictly sequential — every request paid multiple WAN DB round-trips. Parallelized independent work with identical assertions: fixture logins, visibility/activity/media matrices, rate-limit bursts (the limiter serializes counter increments, so over-limit requests still deny), the 300-request sampled chat-rooms loop (now chunked inside one 60s window — also removes the window-expiry flake), and per-type parallel teardown. Result on Neon: diary 178s (was 804s timeout), runtime-verify 142s (was 720s timeout + flake), browser 145s (was 300s timeout).

### Prior gate attempts (same tree, Supabase dev DB)
- `test:master` on transaction pooler: 29/32 — diary/runtime/browser wrapper timeouts (all assertions green standalone) + runtime sampled-RL flake.
- On session pooler: 29/32 — feed (leaked `__br_*` fixtures from killed runs), plant-doctor + runtime-prod (EMAXCONNSESSION at the 15-client cap).
- Orphaned `__tmp-redesign-verify.mts` processes from earlier sessions were found holding connections and killed; maintenance-mode pollution from a crashed run explained the forum 9-fail blip (106/106 clean after).

### Other gates on final tree
`npx tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run test:fast` 5/5 ✓ · `npm run build` ✓ (157 routes) · browser-verified every major route at 1440/1024/390 incl. populated fixtures.

**Bottom line:** every redesign assertion and every backend contract passes on the final tree. The earlier reds were environmental (WAN latency, pooler client cap, fixture pollution) — none were code defects.
