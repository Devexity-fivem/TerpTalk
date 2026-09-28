# Codebase File Inventory & Classification

Companion to [`full-codebase-integrity-audit.md`](./full-codebase-integrity-audit.md) — finding IDs cross-reference the master document.

**Scope:** 630 tracked files at HEAD `06b25e77019bef8ec01e86a6bb59856df824b6f3` (`progression-v2`).

**Classification legend:** `LIVE` = active application behavior · `SUPPORT` = test/tooling/ops dependency · `LEGACY` = intentionally retained · `DEAD` = no meaningful callers · `ORPHAN` = disconnected · `DUP` = superseded duplicate · `HISTORICAL` = migrations/docs-of-record.

**Method:** every file was enumerated via `git ls-files`; meaningful source files were read or grepped for callers, imports, exports, route reachability, schema references, and test registration. Trivial config/generated files receive concise classification.

## Summary counts

| Area | Files | Live | Support | Legacy | Dead/Orphan |
|---|---|---|---|---|---|
| `src/app/api/**` | 106 route.ts | 106 | — | — | 0 |
| `src/app` non-api | ~108 (pages/layouts/loading/sitemap/go-redirect) | ~107 | — | 1 (`/ops` redirect) | 0 |
| `src/components/**` | 121 | 121 | — | — | 0 |
| `src/lib/**` | 123 | ~110 | 5 | 4 | ~4 (dead exports, not files) |
| `scripts/**` | 42 | — | 40 | 2 (one-time migration/backfill) | 0 |
| `prisma/**` | 71 (schema, seed, 68 migrations, lock) | 2 | 1 | 68 | 0 |
| `docs/**` | 9 (pre-audit) | 2 active docs | — | 7 historical | 0 |
| `public/**` | 7 | 7 | — | — | 0 |
| Root config | ~16 | 16 | — | — | 0 |

**No fully-dead files were found.** Dead code exists at the *export* level inside live files (L-02) — files themselves all have callers.

---

## Root configuration files

| File | Class | Notes |
|---|---|---|
| `package.json` | LIVE | 16 runtime deps all used; 8 devDeps; `overrides` pins cookie/@auth/core |
| `package-lock.json` | LIVE | lockfile consistent with package.json |
| `next.config.ts` | LIVE | CSP/HSTS/security headers; no sourcemaps in prod |
| `vercel.json` | LIVE | single cron `/api/cron/terpbot` |
| `tsconfig.json` | LIVE | strict TS |
| `eslint.config.mjs` | LIVE | flat config, react-hooks rules enforced (a P5 bug was caught by it) |
| `postcss.config.mjs` / `components.json` / `next-env.d.ts` | LIVE | tailwind4 + shadcn plumbing, generated types |
| `.env.example` | LIVE | complete and accurate vs `process.env` sweep |
| `.gitignore` | LIVE | covers .env, backups, tsbuildinfo |
| `AGENTS.md` / `CLAUDE.md` | SUPPORT | repo rules; CLAUDE = @AGENTS pointer |
| `README.md` | LIVE (doc) | accurate — stack, env, migrate gate, test tiers all match code |
| `prisma/seed.ts` | SUPPORT | categories/rooms/staff seed |
| `public/sw.js` | LIVE | static-only cache, prod-registered via `sw-register.tsx` |
| `public/logo.png`, `public/terpbot.svg`, `public/icons/*` | LIVE | brand assets, referenced |

---

## `src/lib/**` — server libraries (123 files)

### Foundational (all LIVE)

| File | Role | Verified |
|---|---|---|
| `prisma.ts` | Prisma singleton | standard pattern |
| `auth.ts` | NextAuth options, sessionCookieName, sessionVersion embed | JWT-only, revocation via `isSessionValid` |
| `security.ts` | `activeAuthor`, `blockedUserIds`, `blockExistsBetween`, `hashIp`, `isSessionValid`, `enforceLinkTrust`, `containsExternalLink`, role helpers, `logSecurityEvent`, `publicUserSelect`, `rankableProfile`, `XP_ORDER`, LIMITS | shared where-fragments used across ~40 callsites — single privacy vocabulary |
| `rate-limit.ts` | DB-backed limiter + cleanup | consumed via `rateLimit` + `progressionRateLimit` |
| `require-staff.ts` | fresh-DB role gates (`requireStaff`/`requireModerator`/`requireAdmin`/`requireSupport`) | admin/mod routes all use it |
| `settings.ts` | `Setting`-row backed flags (`SITE_SETTINGS`) | used by chat gate, maintenance, features |
| `maintenance.ts` | maintenance-mode gate + staff bypass | invoked in staff-applications route; page `/maintenance` |
| `cron-claim.ts` | claim/release/markDone/runCronTask | cron idempotency core |
| `turnstile.ts` | Cloudflare Turnstile verify | register route; fails closed in prod |
| `recovery.ts` | bip39 phrase gen/hash/verify | recovery routes; bcrypt-hashed |
| `profanity.ts` | `censorText`/`isProfane` via profanity-guard | registration/profile/content paths |
| `week.ts`/`time.ts`/`slugs.ts`/`utils.ts`/`theme.ts`/`callback-url.ts`/`seo.ts`/`pusher.ts`/`pusher-client.ts` | helpers | `slugs` canonical paths used by notify/announce; `theme` inline init script; `seo` buildMetadata/json-ld |

### Privacy & visibility (all LIVE, verified)

`diary-visibility.ts` (publicDiaryWhere/viewableDiaryWhere/canViewDiary), `profile-settings.ts` (P2 section order/hidden/theme), `public-profile.ts` (public DTO + sections + notable stats — ~1.2k LOC, strict selects), `grower-directory.ts` (M3 mastery filter), `chat-access.ts` (room gates; L-01 triplication), `chat-activity.ts` (badge-mode activity under canAccessRoom boundary), `search-dto.ts`/`search-terms.ts` (search shaping), `member-home.ts` (home feed for members, owner-scope intel calls).

### Progression & reputation (LIVE with documented overlap)

| File | Class | Notes |
|---|---|---|
| `progression.ts` | LIVE | V2 engine — award/caps/standing/reversals/mastery/unlocks/perks/drift. Dead export: `unlockStates` (L-02). |
| `progression-config.ts` | LIVE | XP_TABLE, REP_RANKS, masteries, STANDINGS, UNLOCK_REGISTRY (26 live + 14 future) — M-01 rows |
| `reputation.ts` | LEGACY — INTENTIONAL | V1 frozen-ledger toolkit: reversal fns (live via outbox+moderation), `checkBadges` (live via diary updates), `findReputationDrift` (live via cron). Award path dead in prod. Dead exports: `getTrustScore`, `repRateLimit`, `checkBadgesOccasionally`, `getTierPerks` (L-02); `runPostAwardEffects`/`postDemotionEffects` alive only for `rep3-backfill.mts`. |
| `reputation-config.ts` | LEGACY — INTENTIONAL | V1 tiers/perks/event types — read by frozen-ledger code + migrate script |
| `reputation-outbox.ts` | LIVE | pending V1 reversal queue + drain |
| `progression-outbox.ts` | LIVE | pending V2 reversal queue + drain |
| `badge-registry.ts` | LIVE | human badge rules; bot-badge isolation documented |
| `quests.ts` / `challenges.ts` / `streaks.ts` / `journeys.ts` / `weekly-recognition.ts` | LIVE | keyed payouts + reconcilers; quest slots gated by hasUnlock |
| `experiment-progression.ts` / `experiments.ts` | LIVE | experiment XP awards + reversal |
| `contest-awards.ts` | LIVE | weekly/monthly winner resolution (cron) |
| `referrals.ts` | LIVE | delayed payout + reconcile |
| `grow-journey.ts` | LIVE | journey XP markers |

### TerpBot (~16.3k LOC; all LIVE)

`terpbot.ts` (announce/post/sanitize/purge), `terpbot-data.ts` (~40 command handlers — all registry commands covered), `terpbot-events.ts` (BotEvent ledger + bot badges, human-rep isolation documented), `terpbot-intel.ts` + `terpbot-intel-{context,calc,status,snapshot,decisions,checklist,episodes,timeline,merge,validate,why,types}.ts` (deterministic intel engine; scope enforced at query), `terpbot-assist{,-grow,-triggers}.ts` (private assist scans), `terpbot-session.ts` (conversation state, sweep), `terpbot-nl-parse.ts`/`terpbot-nl-vocab.ts`/`terpbot-intents.ts` (mention parser — public commands only), `terpbot-profile.ts` (P5 owner insights), `terpbot-constants.ts`, `grow-intel.ts` (owner-scope pipeline), `chat-commands.ts` (registry).

### Content, media, comms (all LIVE)

`markdown.tsx` (escape+allowlist renderer), `blob.ts` (validated uploads + ref-protected delete), `notify.ts` (single choke point + purge + deep links), `mentions.ts` (@-notify), `notification-2*.ts` (delivery plumbing — "-2" is historical naming, still the live system), `profanity.ts`, `media-embed` helpers inside components.

### Domain libs (all LIVE)

`community-stats.ts` (privacy-floored aggregates: NUMERIC_MIN 5, LABEL_MIN 3, CROSS_MIN 10), `member-home.ts`, `grow-fields.ts`, `grow-compare.ts` (substrate for future compare feature — SUPPORT-level usage by member-home today), `next-action.ts`, `problem-wizard` helpers, `stage-tips.ts`, `diary-weeks.ts`, `diary-edit.ts`/`diary-update-edit.ts`/`setup-edit.ts` (content edit parsers), `strain-*.ts` (fields/stats/linkage), `symptom-tags.ts`, `guides.ts`, `deals-access.ts` (M-03), `spotlight.ts` (M-03), `affiliate.ts`, `breeders.ts`, `yield.ts`, `live-stats` helpers, `ops-metrics.ts` (admin dashboards), `trust-signals.ts` (detectors incl. dormant legacy pair — L-04), `moderation.ts` (logModAction/applyAccountActionInTx), `profile-widgets.ts` (records/owner-analytics unlock ids), `saved-searches` helpers, `chat-cleanup.ts`, `terpbot-setup` helpers.

**No orphan lib files found.** Largest files: `terpbot-intel.ts` (~3.7k), `public-profile.ts` (~1.2k) — sized but focused; no action required.

---

## `src/app/api/**` — 106 routes (all LIVE)

Every route was inventoried; auth/privacy patterns verified across the set. Grouped summary (all LIVE unless noted):

- **Auth/account:** `auth/[...nextauth]`, `auth/register`, `auth/recover`, `restricted`, `ping`, `captcha`, `pusher/auth`
- **Profile/account:** `profile` (+`complete`,`export`,`notifications`,`recovery`,`sections`+`[id]`,`terpbot`), `onboarding/{complete,follow,interests,suggestions}`, `settings/announcement`
- **Forum:** `forum/threads`(+`/accept`,`/follow`,`/similar`,`/symptom`,`/view`), `forum/posts`, `forum/tags`, `forum/polls/[id]/vote`, `forum/updates`, `categories`(+`/follow`), `bookmarks`, `saved-searches`
- **Diaries:** `diaries`(+`[id]`+`/[id]/discuss`,`/experiments`+`[experimentId]`,`/export`,`/harvest`,`/intel`), `diaries/updates`, `diary-contest`
- **Content:** `guides`+`[slug]`, `strains`(+`/photos`), `setups`(+`/comments`), `reactions`, `follows`, `blocks`, `reports`, `feedback`
- **Comms:** `chat/rooms`,`chat/messages`,`chat/commands`, `messages`, `notifications`, `search`+`suggest`
- **Progression:** `progression`, `achievements`, `challenges`, `contest`, `users/[username]`(+`/card`,`/reputation`,`/sections/[section]`), `users/search`
- **Moderation/admin:** `moderation/{queue`+`[id]`+`bulk`+`staff`, `bulk`, `actions`, `reports`, `reputation`, `user`}`, `admin/{affiliates/{partners,products,stats}`, `announce`, `audit`, `experiments`+`[id]`, `features`, `feedback`+`[id]`, `media`, `reputation`(+`flags`), `security`, `settings`, `stats`, `terpbot`, `users`+`[id]`, `youtubers`}`
- **Misc:** `cron/terpbot`, `stats`, `staff/applications`+`[id]`+`apply`, `youtubers/apply`, `go/[slug]` (non-api), `sitemap-index.xml/route.ts` (non-api)

**Zero dead API routes.** All 106 are reachable (nav/fetch callers or platform entry points: cron, pusher auth, nextauth).

---

## `src/app/**` non-API (pages)

| Area | Class | Notes |
|---|---|---|
| `(home)/page.tsx` + loading | LIVE | landing incl. member-home + chat-teaser + spotlight |
| `about, rules, privacy, terms, help, welcome` | LIVE | static/info pages |
| `achievements` | LIVE | reads `userBadge` via /api/achievements (M-06 naming note) |
| `admin/**` (20+ pages) | LIVE | layout-gated (notFound for non-staff); each API re-checks |
| `auth/**` (signin/signup/recover/layout) | LIVE | |
| `calculator` | LIVE | VPD/etc. grow calculator — real tool |
| `chat` | LIVE | room UI |
| `contest` | LIVE | boards |
| `deals` | LIVE | gated products browser |
| `diaries/**` (index, [id], new) | LIVE | full lifecycle UI incl. discuss-button, intel panel |
| `discover`, `feed`, `forum/**`, `guides/**`, `questions` | LIVE | discovery surfaces |
| `growers` | LIVE | M3 directory (P4) |
| `leaderboard` | LIVE | XP-ordered, `rankableProfile` |
| `maintenance`, `restricted` | LIVE | ops surfaces |
| `messages`, `notifications` | LIVE | DM + notification centers |
| `moderation/**` | LIVE | queue/cases — staff-gated |
| `ops` | LEGACY — INTENTIONAL | redirect to `/admin`, correctly gated |
| `plant-doctor` | LIVE | symptom wizard → thread |
| `profile/**` (index, complete, customize) | LIVE | P0–P5 surfaces |
| `progress` | LIVE | member progression view |
| `reputation` | LIVE | V2 progression explainer (not V1) |
| `search` | LIVE | |
| `settings` | LIVE | account settings |
| `setups/**` | LIVE | grow setup showcase + comments |
| `staff/apply` | LIVE | staff application |
| `strains/**` (index, [id], breeder/[name], new) | LIVE | catalog + detail + breeder pages |
| `u/[username]` | LIVE | public profile (page + profile-client) |
| `youtubers` | LIVE | program page + apply |
| `sitemap.ts`, `sitemap-index.xml`, `robots` (in app or public) | LIVE | PUBLIC-only indexing, `activeAuthor`/`rankableProfile` filters |

---

## `src/components/**` — 121 components (all LIVE)

Every component has ≥1 importer (checked for all suspicious names: `reputation-earn`, `reputation-roadmap`, `sw-register`, `spotlight-fx`, `thread-scroll-bar`, `week-navigator`, `saved-threads`, `count-up`, `member-greeting`, `milestone-celebration`, `user-popover`, `json-ld`, `breadcrumbs`, `cannabis-leaf` — all imported).

`ui/` primitives (21 files): avatar, confirm-dialog, content-card, empty-state, loading-states, page-header, profile-card, section-card, segmented-control, skeleton, stat-strip, surface, tabs, tag, time-ago, toast, tooltip, tt-badge, activity-item — the design-system layer; consumed consistently.

Domain components all map to live features listed in the API/page inventory. Notable: `terpbot-insights` (P5), `grow-intel-panel`, `env-insights`, `diary-charts`, `experiment-*`, `chat-room`/`chat-panel`, `poll`/`poll-composer`, `problem-wizard`, `command-palette`, `member-home`, `onboarding-stepper`, `profile-card`, `tier-chip` (V2 rank chip honoring `NEXT_PUBLIC_VISIBLE_STATUS` kill flag).

---

## `scripts/**` — 42 files (all SUPPORT)

- **Registered test suites (26):** all listed in `master-tests.mts` — verified each `file:` path exists.
- **Harness/support:** `master-tests.mts`, `db-guard.mjs`, `fixtures/`, `lib/`, `terpbot-setup.cjs`, `verify-security.cjs`.
- **Ops scripts:** `prebuild-migrate.mjs` (deploy gate), `backup.ts`, `seed-*.cjs` (strains catalog, affiliates, clone-to-home, mars-hydro — all db-guarded, idempotent, attribution-safe).
- **One-time migration artifacts (SUPPORT — pending/archive):** `progression-v2-migrate.mts`, `rep3-backfill.mts`. Both guarded, idempotent, documented; keep until prod migration completes, then archive.
- **No unregistered test files** — the temp QA scripts noted in M-05 were deleted before commit (directory verified clean of `.tmp.*`).

---

## `prisma/**` — 71 files

| Item | Class |
|---|---|
| `schema.prisma` | LIVE — 62 models; notable: no Session/Account (JWT), Reaction NULL-unique gap (L-07), stale StrainPhoto comment (L-06), dual badge tables (M-06) |
| `seed.ts` | SUPPORT |
| 68 `migrations/*/migration.sql` | HISTORICAL — chronological, additive-or-intentional-drops, one harmless ordering oddity (I-01) |
| `migration_lock.toml` | SUPPORT |

---

## `docs/**` — 9 pre-audit files

| File | Class |
|---|---|
| `progression-v2-design.md`, `progression-v2-implementation-plan.md` | ACTIVE DOC — design source of truth |
| `audit/global-ui-implementation-plan.md`, `growdiaries-evidence.md`, `profile-v2-and-ui-ux-audit.md`, `profile-v2-implementation-plan.md`, `terptalk-roadmap-reconciliation.md`, `terptalk-vs-growdiaries-audit.md` | HISTORICAL — phase docs; superseded by this audit series |
| `data/strain-research.md` | HISTORICAL — seed research basis |

---

## Dead-code findings (detail in `dead-code-and-unfinished-features.md`)

| File/Symbol | Evidence | Confidence | Dependency |
|---|---|---|---|
| `progression.ts → unlockStates` | zero callers (grep src+scripts) | VERIFIED | none — safe to remove |
| `reputation.ts → getTrustScore` | zero callers | VERIFIED | none |
| `reputation.ts → repRateLimit` | zero callers (verify-security regex tolerates it) | VERIFIED | L-05 |
| `reputation.ts → checkBadgesOccasionally` | zero callers | VERIFIED | none |
| `reputation.ts → getTierPerks` | zero callers | VERIFIED | none |
| `reputation.ts → runPostAwardEffects/postDemotionEffects` | only `rep3-backfill.mts` | VERIFIED | one-time script |
| `trust-signals.ts` legacy pair detectors | query frozen ledger; can flag only pre-cutover data | VERIFIED — intentionally dormant | documented |
| `Achievement`/`UserAchievement` live usage | only migration writes; `hasUnlock` reads (dormant — M-02) | VERIFIED | unlock registry future rows |
| `ChatRoom` upsert re-asserting constants in GET | rooms route | VERIFIED | I-04 |
