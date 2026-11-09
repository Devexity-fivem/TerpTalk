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
| 2 | Foundation: palette/typography/density tokens, font swap | ⏳ in progress |
| 3 | Shell: unified nav (rail, top bar, mobile dock, chat-first) | ⬜ |
| 4 | Home + Stream density | ⬜ |
| 5 | Forums + thread detail | ⬜ |
| 6 | Diaries, setups, strains | ⬜ |
| 7 | Profiles + moments | ⬜ |
| 8 | Chat surface, messages, notifications | ⬜ |
| 9 | Progression, guides, plant-doctor, help, contest, settings, auth | ⬜ |
| 10 | Admin/mod consistency pass | ⬜ |
| 11 | Responsive + a11y sweep at 5 viewports | ⬜ |
| 12 | Verification gate + final report | ⬜ |

## 4. Known issues / risks
- Dev DB is nearly empty (test fixtures only) — rich states need seeded fixtures or honest empty-state review.
- `tt-reveal` scroll-timeline sections render blank in static screenshots — use `reducedMotion` emulation for captures.
- Setup fixture is private (404 for guests) — setup detail needs a public fixture.
- Test fixture usernames (`__test_pv2_*`) surface on the landing — data-quality note, not a redesign bug.
