# Global UI/UX — Locked Design & Implementation Plan

**Status:** design-locked, awaiting owner approval. No implementation.
**Baseline:** `progression-v2 @ 8b6d609`.
**Evidence:** `profile-v2-and-ui-ux-audit.md` §19–§33 (primary), `terptalk-roadmap-reconciliation.md`.
**Companion:** `profile-v2-implementation-plan.md` — P0 batch shares U0/U2 work; sequence jointly.

---

## 1. Locked primitive foundation (U0)

Audit the file first; **extend before creating**. Existing solid primitives — `ContentCard` (compact/media), `Avatar`, `Badge`/`tt-badge`, `Tooltip`/`InfoTip`, `Skeleton`, `EmptyState` (16 consumers), `SegmentedControl`, `Toast`, `TimeAgo`, `Surface`, `ActivityItem`, `TierChip`, `RoleBadge`, `AchievementBadge`, `UserPopover`.

New/extended primitives to build:

| Primitive | Status | Spec |
|---|---|---|
| `PageHeader` | NEW | h1 + subtitle + action slot; replaces the repeated `font-display text-3xl ... mt-1.5 mb-2` recipe on ~30 pages |
| `SectionCard` | NEW | titled surface (`tt-spotlight`/`bg-card` + border + h2) — the most-repeated recipe in the codebase (~50 inline uses) |
| `Tabs` | NEW | single APG implementation — see §3 |
| `StatStrip` | NEW | label+value cells, ≤4 prominent + expandable rest; replaces 8-col stat grids (profile, bot, leaderboard) |
| `ConfirmDialog` | NEW | styled accessible dialog; replaces native `confirm()` — see §4 |
| `EmptyState` | EXTEND | add `action` prop consistently; migrate raw "No X yet" text sites |
| `LoadingState` | EXTEND `Skeleton` | named skeleton compositions (list, cards, stat-strip) instead of bespoke |
| `ProfileCard` | NEW (wraps `UserPopover`) | compact identity row = avatar+nameplate+rankchip; popover on interact; consumed everywhere per Profile plan §15 |
| `Tag` | NEW | standalone chip (tags currently inline-styled in several places) |

Rules: primitives live in `src/components/ui/`; no page-level bespoke recipes for these patterns after migration; every primitive supports dark+light via existing tokens.

## 2. Progression vocabulary lock (U1)

Four vocabularies currently render at once. Locked hierarchy:

| Term | Definition | Display |
|---|---|---|
| **Rank** | 13-rank ladder (Seed → Master Cultivator) | chip/name, prestige layer |
| **XP** | the currency | number in progress context only — never a headline |
| **Grow Level** | sub-level within rank + stage name | "Grow Level 12 · Foxtailing" — secondary text, tooltip explains |
| **Mastery** | 5 paths, M1–M10 | path chips in Mastery Map; "path level" not "rank" |
| **Standing** | trust tiers (Unknown→Elder) | named chip only (≥Known public) |
| **Achievement** | milestone-engine award (Phase IV) | distinct from Badge |
| **Badge** | existing awarded pins | chips |
| **Unlock** | capability grant | "capability" language, not "reward" |
| **Streak** | check-in habit | exists; opt-out aware |
| **Quest** | daily/weekly task | "quest" |
| **Challenge** | competitive/event | "challenge" |

**Migration map:** "reputation" vocabulary → "progression" (page copy, URLs stay via aliases — `/reputation` slug persists, title already "Grow your rank"); `trustLevel` field → standing chip (drop from API); "tier" in TierChip → "rank"; remove `GUIDE_PUBLISHED` from `/reputation` earn list until wired (dead-event copy — P1 integrity item).

## 3. Tabs lock (U1)

One `Tabs` primitive (APG): `role=tablist/tab/tabpanel`, arrow-key navigation, `aria-selected`/`aria-controls`, Home/End support, deep-linkable via `?tab=` where the tab is content-routing (profile, notifications), overflow-x scroll on mobile.

**Audit before migrating** — three idioms exist:
- custom button `role=tab` sets (profile tabs, `/progress`, growers, leaderboard) — **migrate**
- `SegmentedControl` — keep for *filters* (it's a filter control, not a tab); do NOT convert where it filters list content inline
- overflow tab bars (questions, notifications categories) — **migrate** (they switch content views)

Rule: if it switches a panel → `Tabs`; if it filters a list inline → `SegmentedControl`. Document in the primitive's JSDoc.

## 4. Confirmation dialogs (U1)

`ConfirmDialog` (accessible modal: focus trap, Escape, labeled, destructive-variant): replaces native `confirm()` **only where user-impacting** — block/unblock (`user-actions.tsx`), diary delete, account delete, unfollow. Cosmetic `confirm()`s may wait; audited list at implementation time, not blanket-swept.

## 5. Card hierarchy (U1)

| Recipe | Use |
|---|---|
| `SectionCard` | page section container (titled surface) |
| `ContentCard` compact | text-forward list rows (threads, questions, diaries in lists) |
| `ContentCard` media | image-forward (diaries, harvests, setups, strains w/ photo) |
| `StatStrip` | metric rows |
| `ProfileCard` | member identity |
| list row | plain row where a card is overkill |
| timeline card | diary updates (existing update card — keep) |

Target: zero bespoke card recipes after migration — profile harvest/grow cards, setup cards, diary cards migrate to `ContentCard` media where appropriate.

## 6. Empty / loading / error (U1)

Every major surface gets the triad:
- **Empty** — `EmptyState` w/ meaning + next action (e.g., "No public grows yet — grows appear here when shared").
- **Loading** — named `Skeleton` compositions matching the eventual layout (stat-strip skeleton ≠ list skeleton).
- **Error** — message + retry where recoverable; API-failing panels currently fail silently (`.catch → null`) — standardize an inline error block.

## 7. Full surface map (locked)

| Surface | Verdict | Key changes | Deps |
|---|---|---|---|
| Home `(home)` | ENHANCE | hero density pass; Spotlight/GotW stay; PageHeader | U0 |
| Nav | KEEP+ENHANCE | verify icon-btn aria-labels; 360px crowding pass when signed in | U0 |
| Forums index/category/tags | KEEP | ContentCard already; PageHeader only | U0 |
| Thread | KEEP | author rows → ProfileCard; ConfirmDialog on report/delete | U0+Cards |
| Post/reply composer | KEEP | a11y: `aria-invalid`+describedby on errors | — |
| Diaries index | KEEP | — | — |
| Diary detail | ENHANCE | lazy `next/dynamic` charts; long-page lazy sections; week-rollup work belongs to reconciliation Phase III not here | U2 perf |
| Diary update form | KEEP | dense-but-correct; mobile target check | mobile pass |
| Harvest report | KEEP | v2 fields are reconciliation Phase III | — |
| Strains index/detail/breeder | ENHANCE | JSON-LD + facet counts = reconciliation Phase III; UI = ContentCard/PageHeader only | U0 |
| Questions | ENHANCE | stage facet + diary link = reconciliation Phase III; tabs→Tabs | U0 |
| Plant Doctor | KEEP | — | — |
| Search | KEEP | results → ProfileCard authors | Cards |
| Chat | KEEP | verify `aria-live` on incoming messages; mobile verify | a11y pass |
| Progress `/progress` | ENHANCE | **add mastery map + build title** (the write-only fix); vocabulary pass | Profile P1 shared |
| Reputation explain | ENHANCE | dead earn-list entries removed | U1 integrity |
| Leaderboard | ENHANCE | StatStrip; merge review vs `/growers` (candidate consolidation — one directory, board as tab) | U0+decision |
| Challenges/contests | KEEP | ProfileCard participants | Cards |
| Notifications | KEEP | tabs→Tabs; EmptyState | U0 |
| Settings (all) | KEEP | + profile-privacy section entry | Profile P1 |
| Help/Rules/Privacy/Terms/About | KEEP | — | — |
| Auth | KEEP | — | — |
| Deals | KEEP | — | — |
| Profile | **REDESIGN** | profile-v2-implementation-plan.md | P0–P4 |
| Feed/Discover | KEEP | ContentCard already | — |
| Staff/admin/moderation | KEEP (out of scope) | — | — |

## 8. Mobile principles (locked)

- One responsive web product; no separate mobile codebase. Native is reconciliation Phase VI.
- Verify at 320/360/390/430/768/1024/1280/1440. Known watch-items: header crowding at 360px signed-in; 3-col stat grids at 320px (StatStrip fixes); chart min-heights on diary page; composer toolbar ≥44px targets; tables need scroll wrappers (yield leaderboard).
- Tabs overflow-scroll; sections collapse before truncation; touch targets ≥44px; popover = tap-first on touch (existing UserPopover behavior kept).

## 9. Accessibility requirements (locked — applies to every new/refactored component)

APG-compliant widgets (tabs, dialogs, menus); visible focus on all interactives; semantic heading order; `aria-label`/accessible name on icon-only buttons; `aria-invalid`+`aria-describedby` form errors; `aria-live=polite` for dynamic lists (chat, notifications); `prefers-reduced-motion` honored (nameplate CSS already does); ≥44px touch targets; contrast ≥4.5:1 verified per accent preset incl. nameplate gradients on dark.

## 10. Performance requirements (locked)

- Profiles: see profile plan §12 (SSR + Promise.all + paged sections + no giant payload).
- Global: no chart libs outside diary/progress pages (`next/dynamic`); shared primitives lightweight (no new client deps without cause); standardize image `loading`/`decoding` attrs; evaluate `next/image` remote-pattern for Blob host once — decision at U2.
- No `no-store` where a short `s-maxage` is safe; privacy-sensitive routes stay uncached.

## 11. Security/privacy checks (locked gates for any UI work)

Markdown sanitization on all member-authored surfaces; no HTML/JS/embed outside whitelist; per-section visibility at server boundary; block→404 propagation to cards/DTOs; UNLISTED never in aggregates; public-only metadata/JSON-LD; cache boundaries respect privacy; no staff-only data in public DTOs; image uploads through existing re-encode pipeline.

## 12. Global UI roadmap (locked)

| Phase | Contents | Gate |
|---|---|---|
| **U0 Primitives** | PageHeader, SectionCard, Tabs(APG), StatStrip, ConfirmDialog, EmptyState(+action), LoadingState compositions, ProfileCard, Tag | — |
| **U1 Consistency** | vocabulary pass + `trustLevel`/dead-field cleanup; tab migrations; ConfirmDialog for block/delete/unfollow; card migration; empty/loading/error sweep | U0 |
| **U2 Perf + profile batch** | shared with Profile P0: SSR public profile, Promise.all queries, paged sections, chart lazy-load, `next/image` decision | U0 |
| **U3 Page-level** | home density, nav crowding, diary lazy sections, leaderboard/growers consolidation, `/progress` mastery map (with Profile P1) | U0–U1 |
| **U4 Account/help/auth polish** | settings profile-privacy entry, error-state sweep | U0–U1 |
| **U5 Mobile verify pass** | live device check at breakpoints post-DB-reset; touch targets; chat; charts | U2 |

**Joint batch:** U0 + Profile P0 + U2 are one work-stream (the primitives land as the profile is rebuilt). Sequence: U0 → Profile P0/U2 → Profile P1 + U3 → Profile P2–P5 staggered with remaining U-phases.

## 13. Don't-build list (locked)

Algorithmic feeds · short-form video · like/popularity rankings · follower-count displays on cards · arbitrary embeds/HTML/CSS · separate mobile product · DM group chats · TerpBot-generated public profile content.
