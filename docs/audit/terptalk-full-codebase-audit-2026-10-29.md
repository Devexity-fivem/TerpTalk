# TerpTalk Full-Codebase Re-Audit — 2026-10-29

**Audit timestamp (UTC):** 2026-10-29 ~06:35Z
**Audited baseline:** branch `dev`, HEAD `0592f088b64636e3ca9980e261995f045e20c341` ("Test infra: fix env-var contract, rename stale suite, complete aliases", 2026-10-19)
**Remote state:** `origin/master` = `origin/dev` = `398377c` ("Activation: author waiting-state on zero-reply question threads"). Local `dev` is **3 commits ahead** (`ba30faa` anti-abuse rep-velocity fix, `f9ffb4c` migration-script cleanup, `0592f08` test-infra) — none pushed.
**Tracked files:** 742 (`git ls-files`). Prior snapshot said 746 — the delta is migration-script cleanup (`f9ffb4c`) plus minor churn.
**Method note:** This audit was conducted inside a working session that also performed the Supabase migration staging. Working-tree changes from that session are disclosed below and are part of the audited state, not hidden.

---

## 1. Executive summary and verdict

**TerpTalk's codebase is in materially better shape than a re-baseline would suggest.** The application is a genuine, feature-dense product — 84 pages, 140 components, 73 Prisma models, 82 migrations, 125 route handlers — with a mature security/privacy posture (positive-authorization db-guard, blocked-author scoping, diary visibility predicates, staleness-gated presence, rate limits on all expensive surfaces) and a deliberately engineered free-tier performance posture (CDN-collapsed fingerprint polling, incremental cursors, keyset feeds, unstable_cache, cookie-deduped view counters, BroadcastChannel badge sharing).

**Production is down — root cause established, not a code defect.** The Neon Postgres project's free-plan compute quota (~110 CU-hours consumed Oct 1–24) was exhausted; both branches were archived Oct 24 and every query is rejected with "account or project has exceeded the quota." Consequences: the live deployment 500s on any DB-touching path, production builds fail at `prebuild-migrate.mjs` → `prisma migrate deploy` (P1001), preview builds fail during `next build` prerender (PrismaClientInitializationError), and the two Vercel crons have been silently failing since Oct 24.

**Verdict for resuming development:** GO for code work NOW (local dev is functional on the new dev Supabase). Production relaunch is blocked until the Nov 1 Neon quota reset unlocks the data export, or the plan is upgraded. Recommended first batch is the DB cutover completion, not feature work — do not build on a dead production surface.

## 2. Baseline, deployment, and CI status

| Item | State | Evidence |
|---|---|---|
| Working tree | 9 modified tracked files, 2 new scripts, 5 untracked docs | `git status` — all session changes uncommitted, disclosed below |
| Local vs remote | `dev` ahead of `origin/dev`/`origin/master` by 3 commits | `git rev-list --left-right --count` |
| Production site | **500** (down since ~Oct 24) | curl 200→500, DB error body |
| Latest prod deploy | `terp-talk-112hsgn7i` — Error (30s) | Vercel CLI `ls`/`inspect` |
| Last healthy prod deploy | ~Oct 19 (10d old) | Vercel deployment list |
| Vercel failure root cause | `prebuild-migrate` → P1001 can't reach DB → build aborts | build logs via `vercel inspect --logs` |
| Preview failures | `next build` prerender `/_not-found` → PrismaClientInitializationError | same logs |
| Neon project | `misty-shape-71837605` (org `org-quiet-scene-42566070`, plan `free_v3`, Vercel-managed) | Neon API |
| Neon compute | suspended Oct 24; start → `ERROR: quota exceeded` | `POST /endpoints/{id}/start` |
| GitHub Actions | CodeQL on `398377c` SUCCESS (Oct 27); CI "failure" entries are on dependabot SHAs (`1c020ea`, `c0b8dd6`, Oct 26) — **run logs not accessible** (no `gh` auth); the referenced run `40333849921` static-verify failure could not be inspected | GitHub REST API |
| Open PRs | Exactly the 5 Dependabot PRs from the initial observation: #15 next-stack group, #16 `@vercel/blob`, #17 `bip39`, #19 `lucide-react`, #20 `emoji-picker-react` | REST API |
| npm audit (prod) | 5 remaining vulns in `@vercel/blob`'s transitive chain (`zod` via `@vercel/cli-config`); fixing requires a breaking downgrade — **deferred** | `npm audit --omit=dev` |
| Next.js | 16.4.0 flagged with a known security advisory by `next dev` (bulk-advisory notice); upgrade pending owner decision | dev-server banner |

### Working-tree changes (this audit session — uncommitted)

- `scripts/db-guard.mjs` — prod markers now match the raw URL (Supabase pooler shares hostnames; the project ref lives in the username). Dev project safe-listed; retired Neon markers kept for stale `.env`s.
- `scripts/security-tests.mts` — fixtures rewritten for Supabase URL forms; suite passes.
- `scripts/master-tests.mts` — prod-endpoint marker updated.
- `README.md`, `.env.example` — Neon → Supabase documentation.
- `src/lib/reputation.ts` — stale "Neon pool" comment corrected.
- `src/app/forum/thread/[slug]/page.tsx` — design-vocabulary pass (tt-spotlight/edge-card on cards, replies eyebrow).
- `scripts/db-export.mts`, `scripts/db-restore.mts` (new) — JSONL dump/restore for the Nov 1 data rescue.
- `AGENTS.md` — regenerated by `next dev` (expected churn).
- `package-lock.json` — `npm audit fix` residue.
- `.env` (gitignored) — repointed at dev Supabase with `connection_limit=1`.
- Untracked `docs/terptalk-*.md` — owner planning docs, left alone.

### Migration staging already performed (operational, not code)

- `terptalk-db` — Supabase free project via Vercel marketplace, ref `dtlksgtsvdfhgsiuktbt`, connected to all Vercel envs as `SUPABASE_*`; all 82 migrations applied.
- `terptalk-dev` — second free project, ref `ovztvfbvylcdpsuchvps`, connected to development env as `SUPABASE_DEV_*`; migrated + seeded (categories/rooms/badges + 658 strains).
- Prod cutover pending: export Neon `main` (44.5 MB) after the Nov 1 quota reset → `db-restore.mts` → flip `DATABASE_URL`/`DATABASE_URL_UNPOOLED`/`POSTGRES_URL_NON_POOLING` → redeploy.

## 3. Architecture map (verified from source)

- **Framework:** Next.js 16.4 (Turbopack), React 19.3, TypeScript 5.9, Tailwind 4 CSS-first (`@theme` tokens in `globals.css`), Prisma 6.19, next-auth v4 (credentials+JWT), Pusher realtime, Vercel Blob media.
- **Data access:** singleton `PrismaClient` with a profanity-censor extension (`src/lib/prisma.ts`); migrations deploy inside `vercel-build` via `scripts/prebuild-migrate.mjs` — production-only, unpooled-URL preference chain, advisory-lock sweep, one warm retry, **fails closed** (build aborts; prior deployment keeps serving).
- **Auth/session:** JWT strategy; `session()` callback re-reads `banned/suspendedUntil/sessionVersion` per call (1 indexed PK lookup — deliberate instant-revocation tradeoff). `getToken` used on the hot `/api/ping` path instead.
- **Presence:** `/api/ping` — JWT auth, >15-min staleness write gate, `after()` drains (chat prune, reversal outbox, challenge/quest/streak evaluation) all rate-limited.
- **Realtime/polling:** Pusher primary (`private-user-*`, room channels on a shared socket); 60s visibility-aware poll fallback; BroadcastChannel + Web Locks coalesce badge refreshes across tabs; `live-refresh` components poll fingerprint endpoints (`s-maxage=15` — Vercel edge collapses poll storms); incremental `?after=` cursors on messages/chat/conversations.
- **Write amplification controls:** cookie-deduped thread-view counters (1/day/browser), unread-state via `threadFollow.lastSeenAt`, keyset `(ts,id)` feed pagination.
- **Safety rails:** `db-guard.mjs` positive-authorization for mutation scripts (prod-URL markers, explicit override envs, fail-closed on unrecognized hosts); `rateLimit` on search/feed/polls/posts/tags/accept-answer; `unstable_cache` + React `cache()` request memoization; trgm + composite indexes in migrations.
- **Design system:** dual hand-authored palettes ("Pine & Slate" light / "Canopy after midnight" dark), Inter+Sora, CSS-variable tokens, `tt-*` vocabulary (glass, spectrum bars, holo borders, cursor spotlight cards, nameplates, scroll reveal, film grain), shared primitives (`Surface`, `SectionCard`, `PageHeader`, `EmptyState`, `Skeleton`, `Tabs`, `Avatar`, `Tooltip`).
- **Ops:** GitHub Actions — `verify` (generate+tsc+lint+test:fast+audit), `db` (postgres:17 service, migrate+seed+build+DB-tier suites), `gate` (full `test:master` incl. browser; needs Pusher sandbox secrets). Vercel crons: `/api/cron/terpbot` 14:00 UTC, `/api/cron/diary-reminders` 14:30 UTC. `scripts/backup.ts` (pg_dump/file copy → `backups/`).

## 4. Product-vision alignment matrix

| Area | Status | Evidence |
|---|---|---|
| Grow documentation loop (diaries, updates, stages, environment, harvests) | **ALIGNED** | 40+ diary files, stage timelines, env charts, grower tags, harvest prompts; tests: `diary-verify`, `strain-lifecycle` |
| Community Q&A loop (questions → matching → accepted answers → knowledge) | **ALIGNED** | needs-answers board, evidence-matched discovery, author waiting-state, answer deep links, `accept-answer` flow + rate limit |
| Deterministic TerpBot (rules, NL intent parse, evidence) | **ALIGNED** | `terpbot-*.ts` lib family (25+ modules), parser/intel/decisions/pipeline test suites; **zero LLM deps in package.json**; least-privilege evidence scoping; `SCAN_USER_CAP` bounded scans, batched preloads |
| Progression/trust (XP ledger, reversals, caps, streaks, quests, nameplates) | **ALIGNED** | ledger + outbox reversal queues, rep-velocity fix `ba30faa`, integrity suites (`reputation`, `reputation-referral`, `rewards3`), nameplate tier system in CSS |
| Privacy/pseudonymity | **ALIGNED** | username-only accounts (no email field — data minimization in schema comment), `publicDiaryWhere`, `blockedUserIds` post-cache filtering, `hideOnlineStatus` honored, noindex on auth surfaces, banned/suspended → 404 profiles |
| Social/Moments feed | **PARTIALLY ALIGNED** | implemented + tested (`moments-verify`); repost/comment classification for contribution metrics reviewed superficially — needs one pass against `responseCapable` rules |
| Media/uploads | **ALIGNED** | Vercel Blob + auth-aware `/api/media` proxy; `remotePatterns` locked to public blob hosts |
| Moderation/admin | **ALIGNED** | queues, bulk actions, audit trails, staff apps; admin pages `force-dynamic` |
| SEO/discovery | **ALIGNED** | canonical/indexation policy commit `eb22492`, sitemap chunking, JSON-LD, `NEXT_PUBLIC_SITE_URL` everywhere, noindex discipline |
| Monetization/affiliates/deals | **PARTIALLY ALIGNED** | exists (deals browser, affiliates, youtubers) — not yet verified end-to-end this session |
| Referrals/activation | **ALIGNED** | guided activation panel, diary reminders cron, catch-up, harvest prompts, activation metrics surfaces |

## 5. Findings register

| ID | Severity | Confidence | Finding | Evidence | Disposition |
|---|---|---|---|---|---|
| F-01 | **CRITICAL (ops)** | Confirmed | Production down since Oct 24 — Neon free compute quota exhausted; all queries rejected; deploys + crons failing | Neon API quota error, Vercel logs, live 500 | Fix path staged: Supabase move, pending Nov 1 data export |
| F-02 | **HIGH** | Confirmed | `next` 16.4.0 has a published security advisory; unpatched | dev-server warning + npm advisory | Dependabot PR #15 (next-stack group) is the candidate vehicle; validate CI then merge |
| F-03 | **HIGH** | Confirmed | 3 unpushed commits on local `dev` — including `ba30faa` rep-velocity anti-abuse fix — never deployed; prod is behind local work and can't deploy anyway until DB is restored | `git status`/`rev-list` | Push after cutover verification |
| F-04 | **MEDIUM** | Confirmed | Deploy coupling: `prebuild-migrate` fails closed — any DB outage blocks ALL production deploys including code-only fixes (there is no escape hatch by design; acceptable tradeoff but worth documenting in ops runbook) | `prebuild-migrate.mjs` | Keep; add runbook note |
| F-05 | **MEDIUM** | Confirmed | 5 audit vulns in `@vercel/blob` transitive chain (`zod` via `@vercel/cli-config`) — no non-breaking fix available | `npm audit` | Watch; re-run after @vercel/blob bump |
| F-06 | **MEDIUM** | Confirmed | Neon free metering (~100–120 CU-h/mo) is incompatible with actual usage (~110 CU-h/24d) — would recur monthly; mitigated by Supabase move (unmetered) | project consumption API | Resolved by F-01 path |
| F-07 | **LOW** | Fixed | `db-guard`/`master-tests`/security fixtures identified production by Neon endpoint only — post-migration they'd have missed the new prod host | edited files | **Fixed in working tree** (raw-URL markers incl. pooler-username case; suite passes) |
| F-08 | **LOW** | Confirmed | 2 `no-img-element` warnings (admin media, profile complete) — minor LCP/bandwidth | eslint | Optional `<Image>` swap |
| F-09 | **LOW** | Confirmed | 1,211 lint warnings — all `no-unused-expressions` in `*-verify.mjs` assertion-style scripts; intentional style, not defects | eslint | Leave; do not churn |
| F-10 | **LOW** | Confirmed | `.env.prod.tmp` (Oct 11) is a stale env pull with `[SENSITIVE]` placeholders | file listing | Delete on next cleanup; harmless |
| F-11 | **INFO** | Confirmed | Codebase already optimized for free tier — audit found no N+1, unbounded scans, or hot write paths beyond deliberate ones | this session's perf audit | None |
| F-12 | **INFO** | Confirmed | `connection_limit=1` added to dev pooled URL (serverless+pooler pattern); must also be appended to prod `DATABASE_URL` at cutover | `.env` | In runbook |
| F-13 | **INFO** | Confirmed | Cron backlog: terpbot + diary-reminders have failed ~5 days; dedup/idempotency should absorb the backlog on restart — verify first post-cutover run | vercel.json | Watch item |
| F-14 | **INFO** | Unverified | CI run `40333849921` static-verify failure and the Oct 26 failures on dependabot SHAs — logs inaccessible (no `gh`); cannot attribute cause | REST listing | Needs dashboard access |
| F-15 | **INFO** | Confirmed | `experimental.serverSourceMaps` emits an "unknown experiment" warning under 16.4 — likely deprecated key | dev-server output | Remove on next config touch |

## 6. Historical-audit reconciliation

The `docs/audit/` tree contains 13 prior audits + plans. Key reconciliations:

| Prior claim | Doc | Current status |
|---|---|---|
| "Deploys to Vercel (Neon for DB)" + dev/`main` branch model | README, `db-guard.mjs`, `.env.example` | **Stale** — migration to Supabase staged; docs/guard updated in working tree |
| "Mutation-capable tests use the Neon `dev` branch" | README/db-guard | **Superseded** — `terptalk-dev` Supabase project is the new safe target |
| Neon endpoint safety fixtures in `security-tests.mts` | security suite | **Updated** — fixtures now cover shared-pooler + ref-in-username cases |
| Pre-launch hardening (unbounded scans, stuck controls, privacy fix) — `4f75803` | prior audit | **Confirmed fixed** — bounded scans (`SCAN_USER_CAP`), fingerprint polling, incremental cursors verified in source |
| Privacy fixes (privacy controls migration, visibility scoping) | security-privacy-audit | **Confirmed enforced** — `publicDiaryWhere`, `blockedUserIds`, `hideOnlineStatus` honored at ping + home |
| Anti-abuse rep-velocity false positives | `ba30faa` (unpushed) | **Fixed locally, unverified in prod** — deploy pending |
| `progression-v2` ledger architecture | design docs | **Present + live** — ledger + outbox reversal drains verified (`drainPendingReversals`, integrity suites) |
| Vercel/Neon deployment model as operating constraint | README/task §3F | **Superseded by evidence** — Neon free tier is unviable at current usage; Supabase is the replacement (owner-approved in-session) |

## 7. Test coverage and execution

| Command | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | PASS | clean incl. new scripts |
| `npm run test:fast` | PASS 5/5 | static + pure suites (~3s) |
| `npm run test:security` | PASS | DB-tier suite ran **for real against dev Supabase** — db-guard changes exercised |
| `npm run lint` | 0 errors / 1,211 warnings | errors fixed this session |
| `npm audit --omit=dev` | 5 vulns remain | breaking-change-only fixes available |
| `npm run test:master` | **NOT RUN** | needs live dev server + full browser deps; dev Supabase now satisfies the DB prerequisite — recommend a full gate run post-cutover |
| `npm run test:slow` / browser suites | **NOT RUN** | same prereqs |

Coverage strengths: real HTTP/DB exercising of auth, privacy, ownership, reputation, parsing, TerpBot (per AGENTS rules — verified in suite structure). Gaps: no automated runtime/browser verification of the new thread-page vocabulary; ui-contracts are structural not visual.

## 8. Dependency / open-PR review

| PR | Package | Assessment |
|---|---|---|
| #15 | next-stack group (next, react, react-dom, eslint-config-next) | **Priority 1** — likely carries the security fix; breaking-risk surface: Next 16 conventions are already nonstandard (see AGENTS warning); validate `verify`+`db` CI before merge |
| #16 | `@vercel/blob` 2.8.1→2.8.2 | Safe candidate; may also clear part of F-05 |
| #17 | `bip39` 3.1.0→3.1.2 | Recovery-phrase path — low-risk patch bump; regression = `account-verify` suite |
| #19 | `lucide-react` 1.55→1.61 | Icon churn — visual-only; check renamed icons |
| #20 | `emoji-picker-react` 5.0.0→5.1.0 | Composer-only client dep; lowest risk |

Merge order: #15 → #16 → #17/#19/#20. All target `master`.

## 9. Known limitations and unverified claims

- GitHub Actions run logs (incl. `40333849921`) — no `gh` auth; conclusions drawn from REST metadata only.
- Individual dependabot PR diffs — listed, not inspected line-by-line.
- `test:master`/browser tiers not executed (prereq-heavy); fast+security tiers verified for real.
- Interactive UX verification — dev preview served + markup inspected; no scripted browser assertions this session.
- ~697 of 742 files inventoried (CSV appendix) rather than fully line-read; every major security boundary, data flow, and hot path WAS read.
- Monetization/affiliate flows not traced end-to-end.
- Whether repost/comment events inflate contribution metrics (`responseCapable`) needs one dedicated pass.

## 10. Priority roadmap

1. **Immediate — finish the DB cutover (F-01).** Nov 1: export Neon `main` → restore into `terptalk-db` → flip prod envs (+`connection_limit=1`) → redeploy → verify site + spot-check data → watch first cron runs (F-13) → push the 3 local commits → delete Neon resource after soak.
2. **Integrity — merge Dependabot batch (F-02, F-05).** #15 first for the Next advisory; run `verify`+`db` CI on each.
3. **Stability — full `test:master` gate** against dev Supabase; add `withQueryCount` budgets for hot routes; remove `experimental.serverSourceMaps`.
4. **Core product — activation/moments metrics pass:** verify `responseCapable` classification for reposts/comments vs progression accounting (F-matrix row).
5. **Experience — UI consistency tail:** the thread-page vocabulary pass is done; sweep remaining low-coverage pages (`questions`, `deals`, `contest`, `settings`) for the same treatment.
6. **Deferred** — LLM features (contradicts TerpBot constraints), video feeds (contradicts Moments decision), platform rewrites.

**Owner decisions required:** (a) production upgrade vs. wait for Nov 1 — already answered (wait + Supabase); (b) merge window for PR #15 (has breaking-risk surface); (c) whether Moments stays in its current scope vs the earlier "no generic short-form" decision — implementation exists and is cultivation-scoped; document the call.

## 11. Go / No-Go

**GO** for development on the current baseline — local dev, tests, and CI prerequisites are all functional on dev Supabase. **NO-GO on any production-affecting action until the cutover completes** (prod is already dead; the only path back is the staged migration). First batch = cutover + PR #15, both for root-caused reasons.
