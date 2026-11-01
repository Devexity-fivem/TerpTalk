# TerpTalk — Product Vision: The All-in-One Growers' Platform

**Status:** living document, written 2026-11-01 post-cutover + rebrand.
**Thesis:** no competitor is both a real forum AND a real grow-log tool AND
a strain database. TerpTalk already is all three, plus gamification and an
assistant. The job now is depth + polish, not more surface area.

## Competitive map

| Competitor | Core strength | What they lack | Our counter |
|---|---|---|---|
| GrowDiaries | Week-by-week diary UX, equipment taxonomy, contests, native app | Forum is thin, no strain catalog depth, no gamification, no assistant | Deeper metrics (VPD/PPFD/CO2/trichomes), real forum, XP/mastery, TerpBot |
| Rollitup | Forum scale (881k threads, 16.7M posts), "featured grow" hooks | Dated UI, unstructured journals, no strain data, no progression | Modern design system, structured diaries, reputation economy |
| 420 Magazine | Guides/education hub, strain reviews, news layer | Legacy software, weak diaries, no tool layer | Structured grow tools + guides + SEO surface |
| THCFarmer | Equipment/nutrient depth | Same legacy-forum limitations | Grow setups showcase + linked equipment |
| ICMag | Breeder/genetics credibility | Niche, not a tool platform | Strain catalog (658) + diary-linked genetics + breeder pages |

## What we already own (verified in code)

- **Grow logs**: stage lifecycle (8 stages), weekly updates w/ 15+ env
  metrics, nutrients per update, trichome/aroma/health state, harvest
  report + lessons, yield, photo wall, week navigator, env charts,
  height chart, stage timeline, current-conditions band, streaks
- **Community**: forum w/ accepted answers, Q&A, threads/posts/reactions,
  follows/blocks, DMs, group chat, notifications + web push
- **Strains**: 658-entry catalog, breeder pages, diaries linked per strain,
  harvest ratings roll up to strain page
- **Progression**: XP ledger, levels, badges, mastery, quests, streaks,
  weekly/monthly recognition + contest system
- **Assistant**: deterministic TerpBot (parser, evidence engine, assist
  triggers, weekly digest, dormant-thread scan)
- **Trust/moderation**: full queue, reputation-velocity anti-abuse,
  rate limits, captcha, abuse flags, moderation actions
- **Commerce-ready**: affiliate products/clicks, deals page, setups
- **Ops**: cron-pinned daily jobs, security events, admin command center

## Design system (post-"Verdant Ember")

- Dark flagship: ink-green `#070a08`, mint-jade `#3ef0a8`, ember accent,
  iris spectrum; light botanical counterpart
- `Surface` primitive w/ `spotlight/edge/lift`; `SectionCard` composes it
- `tt-*` vocabulary on ~80 surfaces; admin is a glass sidebar rail
- Inter + Sora; spectrum bar is the brand signature

## Roadmap to overtake GD — ordered by leverage

### Phase 1 — Diary depth (the battleground)
- [x] Week-tabbed update editor rail — chip row files updates into any
      week ≤ current (server honors explicit `weekNumber`) — shipped
- [x] Equipment taxonomy — `GrowSetup` already carries GD-grade fields
      (tent, lighting, ventilation, fans, containers, medium, nutrients,
      controllers) and diaries link via `setupId`; diary-level fields
      (lightType, mediumType, containerSize, spaceDimensions, techniques[])
      display on the detail page — done at the data layer
- [x] Diary auto-save — scoped draft keys, restore-on-first-open,
      debounced writes, discard flow — already shipped (beats GD's)
- [x] Photo-dense feed cards — thumbs on updates, full-width harvest
      strips, photo-backed spotlight — verified + shipped
- [x] "Current conditions" env band in the diary hero — shipped

### Phase 2 — Community scale (vs Rollitup/420Mag)
- [x] Featured grow rotation on homepage — weekly spotlight now
      photo-backed with edge-bleed panel — shipped
- [ ] Guides surface + SEO expansion (guide model exists; needs
      author-facing polish)
- [x] Category-level customization — `icon`/`color` fields existed in
      the schema; the forum index now renders them (emoji + accent tint,
      fallback tile when unset). Staff assigns identities via admin —
      that's content work, not code.

### Phase 3 — Platform moats
- [x] Public "vs" page — `/compare` honest feature matrix, sitemap-wired
- [x] Diary import/migration hook — "switching platforms?" hint on the
      new-diary flow points at the week rail for back-filling history;
      a real GD-export parser is a larger build if demand shows up
- [x] Mobile story — PWA manifest + service worker + install prompt
      shipped; native app is a separate project

## Non-goals (don't build these)
- Marketplace/seed sales — affiliate layer is enough
- Breeder CRM — brand pages only if partners ask
- Anything that weakens pseudonymity — it's a feature, not a gap

## Engineering notes for future devs

- Icon registry: `src/lib/icons.ts` — never import lucide barrel
- Card surfaces: prefer `Surface`/`SectionCard` props over literal classes
- Cron: UTC dual-entry + `isCronTargetHourCT` gate; claims are `Setting` rows
- DB: Supabase pooled runtime (`connection_limit=1`), session-mode migrations
- Gates: `npm run test:fast` every change, `test:master` before release
- Lint must stay at 0/0 — the scripts assertion DSL is scoped off in config
