# Dead Code & Unfinished Features Audit

Companion to [`full-codebase-integrity-audit.md`](./full-codebase-integrity-audit.md).

> **RESOLUTION STATUS (post-P3/P5 reconciliation):** `unlockStates`,
> `getTrustScore`, `repRateLimit`, `getTierPerks` were removed.
> `checkBadgesOccasionally` was re-verified LIVE (called by
> `recordChatMessage` on the chat badge path) — the table below overstated
> it. The room-access predicate was consolidated into `roomAccessDecision`.
> `Achievement`/`UserAchievement` is documented dormant-by-design (see the
> reconciliation doc). Migration scripts retained until prod migration.

## Dead code

`File/Symbol | Evidence | Confidence | Dependency`

| File/Symbol | Evidence | Confidence | Dependency |
|---|---|---|---|
| `src/lib/progression.ts → unlockStates()` | Zero callers in `src/` and `scripts/` (only `ui-contracts-tests.mts` asserts its refusal semantics) | VERIFIED | Removing changes no behavior; keep if an unlock-catalog UI is planned |
| `src/lib/reputation.ts → getTrustScore()` | Zero callers | VERIFIED | none |
| `src/lib/reputation.ts → repRateLimit()` | Zero callers; `verify-security.cjs` regex still tolerates the name (L-05) | VERIFIED | tighten verify-security pattern when removing |
| `src/lib/reputation.ts → checkBadgesOccasionally()` | Zero callers | VERIFIED | none |
| `src/lib/reputation.ts → getTierPerks()` | Zero callers | VERIFIED | none |
| `src/lib/reputation.ts → runPostAwardEffects()`, `postDemotionEffects()` | Only called by `scripts/rep3-backfill.mts` (one-time backfill) | VERIFIED | keep until backfill is confirmed done in prod, then archive together |
| `trust-signals.ts` reciprocal-likes + new-account-likes detectors | Query frozen `ReputationEvent.LIKE_RECEIVED` — no new rows written post-V2, so they can only ever re-flag pre-cutover data (per-day keys → at most once) | VERIFIED — intentionally dormant | Documented in code comments; harmless |
| `Achievement`/`UserAchievement` tables (live write path) | Only `progression-v2-migrate.mts` writes; `hasUnlock` reads but all achievement-gated specs are "future" | VERIFIED dormant | M-02/M-06 — decide end state |
| `docs/audit/` six historical docs | Phase-era plans/audits, superseded by this series | VERIFIED | mark superseded; keep for archaeology |
| `scripts/progression-v2-migrate.mts`, `rep3-backfill.mts` | One-time operational artifacts (idempotent, db-guarded) | VERIFIED intentional | retain until prod migration confirmed complete |

**No dead files, dead routes, dead components, dead registry-consumed features, or dead cron jobs were found.** All 106 API routes are reachable; all 121 components have importers; all libs have consumers.

## Near-duplicates / overlapping implementations (drift risks, not dead)

| Pair | Status | Risk |
|---|---|---|
| `canAccessRoom` vs `roomAccessInfo` vs rooms-GET inline check | 3 copies of the same predicate | L-01 — consolidate |
| `progressionPerksFrom` (perk engine) vs `UNLOCK_REGISTRY` (catalog) | Two sources of truth for the same shipped capabilities | M-01 — decide authority |
| `Badge`/`UserBadge` (live) vs `Achievement`/`UserAchievement` (archive) | Two stores for the same concept | M-06 — decide end state |
| `ReputationEvent` (frozen) vs `ProgressionEvent` (live) | Intentional dual-ledger during V2 cutover; reversal tooling correctly covers both | LEGACY — INTENTIONAL; sunset candidate once legacy reversal window closes |
| `MEMBER_DRIVEN_REP_TYPES` vs `MEMBER_DRIVEN_XP_TYPES` | Intentional frozen/live split, documented | keep |
| `verify-security.cjs` `repRateLimit` alias | Tolerates legacy name | L-05 |

## Unfinished features

`Feature | Current state | User-facing? | Scope | Action`

| Feature | Current state | User-facing? | Scope | Action |
|---|---|---|---|---|
| Unlock-registry capacity perks (images-6/8/10, rate-1.5, rate-2) | **Shipped but mislabeled** — live via `progressionPerksFrom`, registry says "future" | Yes (invisible to members) | Internal inconsistency | M-01: flip to live or remove rows |
| Grow comparisons | Registry rows "future"; `grow-compare.ts` substrate exists; no UI/API | No | Approved future | Keep "future"; build per roadmap |
| Grower Cockpit | Registry "future"; member-home + intel provide partial substrate | Partial (member-home exists as different feature) | Approved future | Keep "future" |
| TerpBot watch/alerts | `terpbot-watch-*` rows "future"; no scheduler/writer found | No | Approved future | Keep "future" |
| Community-evidence aggregates | `community-evidence`, `research-aggregates` rows "future"; `community-stats.ts` engine exists (used by symptom/strain stats) | Partial (symptom/strain stats live) | Approved future | Keep "future" |
| Guide authoring by members | `guide-authoring` row "future"; Guides model + staff authoring live | Staff-only today | Approved future | Keep "future" — note: `guides/new` UI exists but `published` staff-flows it; verify the new-guide page doesn't promise member publishing prematurely |
| Challenge creation | `challenge-creation` row "future" | No | Approved future | Keep "future" |
| Mentoring tools | `mentoring-tools` "future" + achievement gate | No | Approved future | Fix M-02 first |
| Data-quality insights | `data-quality-insights` "future" + achievement gate | No | Approved future | Fix M-02 first |
| Achievement unlock routes | Specs support `achievement:` grants; table dormant | No | Latent | M-02 |
| `slowmodeExempt`/`showcaseSlots` perks | Live in engine; **no registry rows** — invisible in unlock catalog | Invisible | Registry completeness | Optionally add rows or document perks aren't unlocks |
| YouTuber program | Apply flow + admin review exist end-to-end | Yes | **Scope question** — a creator/affiliate feature; verify it was an approved feature (it is wired and functional, not abandoned) | Product review: confirm scope; else mark legacy |
| `quest-slot-4` note | `DAILY_QUEST_COUNT=3` + slots unlock correctly | Yes | — | none |
| Browser QA coverage | P5 checks ran ephemerally; nothing registered | N/A | Testing gap | M-05 |
| Account export completeness | Export covers core domains; omits 6 model families | Yes | Completeness | M-04 |

## Product-scope notes

- **No unapproved monetization, popularity, or vanity mechanics found.** Leaderboards use real XP; spotlight requires rank/streak + public grow; deals gate on rank — all cultivation-relevant.
- **YouTuber program** is the only surface whose product-scope approval couldn't be confirmed from code alone — it is fully implemented (application → admin review → admin listing), not dead weight.
- **No fake-engagement mechanics**: TerpBot never writes member-attributed content; assists are private notifications; announcements announce real events only.
- **No "coming soon" user-facing copy found** except `guides/page.tsx` "Staff guides are coming soon" — accurate (staff-authored guides are the roadmap intent).
- Zero TODO/FIXME/HACK comments in `src/`; zero `console.log` outside intentional cron logging; three `as any`-free — `any` usage is ~3 sites total.

## Proposed cleanup list (do not execute — for review)

1. Remove or archive dead exports (L-02 list) — after confirming `rep3-backfill` won't re-run.
2. Consolidate room-access predicate to one function.
3. Resolve M-01 (registry rows ↔ perks) — biggest conceptual win.
4. Decide Badge vs Achievement end state (M-06) before adding achievement-gated unlocks.
5. `verify-security.cjs`: drop `repRateLimit` alias after L-02 removal.
6. Fix `StrainPhoto.imageUrl` schema comment.
7. Archive `progression-v2-migrate.mts`/`rep3-backfill.mts` post-prod-migration into `scripts/archive/` or document as ops-run.
8. Mark `docs/audit/` historical docs superseded.
9. Add `diaryId`-aware dedupe for reactions (L-07) or accept.
10. `activeAuthor()` on `forum/updates` (L-03).
