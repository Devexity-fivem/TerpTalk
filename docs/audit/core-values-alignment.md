# Core Values Alignment Matrix

Companion to [`full-codebase-integrity-audit.md`](./full-codebase-integrity-audit.md). Values from the approved TerpTalk product direction; evidence is code-level.

> **RECHECK (post-P3/P5 reconciliation):** M-03 resolved — `unlockFrozen`
> now uniformly suspends gated deals (spotlight already honored it), so
> Trust moves to fully ALIGNED. M-05 resolved — a registered browser
> regression suite now covers the privacy oracles, profile V2 rendering,
> and mobile contract, so Accessibility moves to ALIGNED-at-contract-level
> (visual keyboard/focus flows remain manual-review territory by design).
> Maintainability improves: single unlock source-of-truth model, one
> room-access predicate, dead exports removed, explicit Badge/Achievement
> architecture. No value regressed; nothing introduced that incentivizes
> spam, engagement farming, or privacy leakage — all added tests assert
> denial boundaries, not reward paths.

`Value | Alignment | Evidence | Conflict | Action`

| Value | Alignment | Evidence | Conflict | Action |
|---|---|---|---|---|
| **Privacy — users control what they reveal** | ALIGNED | `visibility` on every diary with consistent `publicDiaryWhere`/`viewableDiaryWhere` enforcement across ~15 surfaces; `yieldPrivate`; `publicMilestoneOptOut`; `hideOnlineStatus`; `dmPolicy`; owner-only intel + TerpBot insights; residue purges on privacy loss; no-store on profile APIs | No "hide whole profile" option exists (profiles are discoverable) — product decision, flag if complaints arise | Optionally add profile-level discoverability flag |
| **Pseudonymity — no unnecessary identity** | ALIGNED | Email column was dropped by migration; identity = username+password+recovery phrase; display name optional; no real-name/SSO requirement | — | none |
| **Trust — resistant to manipulation** | ALIGNED | Standing requires peer-validated events with grantor floors, reciprocal discounts, per-source + weekly caps, cluster detection; `unlockFrozen` kill-switch; abuse-flag detectors; reactions/logins/badges award no XP | M-03 bypass weakens the kill-switch at 2 gates; dormant legacy detectors (L-04) | Fix M-03 |
| **Auditability — state transitions explainable** | ALIGNED | `ProgressionEvent`+`ReputationEvent` keyed ledgers w/ reversal rows; `ModAction` log; `SecurityEvent` log; `BotEvent` ledger; outbox reversal queues; drift scans in cron + test gate | — | none |
| **Determinism — no opaque automation** | ALIGNED | TerpBot is 100% deterministic (parser→registry→evidence→decisions; no LLM, no external AI calls); progression/unlocks formulaic; spotlight pick is sha1-stable per week | — | none |
| **Quality over volume** | ALIGNED | Daily/weekly caps, per-diary-per-day update cap, accepted-answer >> reply XP, streak bonuses keyed once-ever, quests bound to real actions | — | none |
| **No fake engagement** | ALIGNED | Bot writes only under bot account; assists are private notifications; seed scripts create no attribution; announcements re-validate real state before posting | — | none |
| **Least privilege** | ALIGNED | Owner-scope queries for intel; staff role fresh-read; mention parser cannot reach staff commands; staff surfaces return 404 (not 403) to members; bot excluded from human rep paths; export owner-only | — | none |
| **Product usefulness** | ALIGNED | Every live feature maps to a real job (document grows, get help, compare knowledge, earn trust); calculator/plant-doctor/intel are working tools, not engagement bait | — | none |
| **Cannabis-centered identity** | ALIGNED | Domain model is cultivation end-to-end; rank ladder is grow-stage themed (Seed→Master Cultivator); mastery paths are cultivation domains; tips/announcements grow-focused | YouTuber program is the least cultivation-specific surface (creator marketing) — verify scope approval | Product review |
| **Accessibility** | PARTIAL | Semantic tabs/dialogs/forms verified structurally; ARIA on insights; focus/keyboard not browser-verified durably; contrast/motion not audited at runtime | No registered browser/a11y suite (M-05) | Register browser QA or accept manual gate |
| **Maintainability** | PARTIAL | Strong: focused libs, single choke points (notify, visibility, room access, award engine), honest comments, zero TODOs, ~zero `any`. Debt: V1/V2 dual systems (badge tables, perk-vs-registry, dual ledgers), triplicated room predicate, dead exports | M-01/M-02/M-06, L-01/L-02 | Execute cleanup queue |

## Product-scope verdict

**Clearly belongs to TerpTalk:** forums, diaries, harvests, experiments, setups, strains, plant-doctor, calculator, TerpBot (all of it), progression/mastery/standing, profile V2, quests/challenges/streaks, contests, deals (Garden Perks), spotlight, guides, chat+DM, notifications, moderation/trust suite, referrals, onboarding, account lifecycle, admin/ops.

**Legacy baggage:** V1 reputation module (frozen, retained for reversals/drift/badges — INTENTIONAL), `Achievement`/`UserAchievement` dormant tables, one-time migration scripts, `reputation-config` tier definitions, `/ops` redirect page, legacy detector queries.

**Incomplete:** M-01 registry-vs-perks inconsistency, M-04 export gaps, M-05 no durable browser QA, dormant achievement-gated unlock paths, `guides/new` member-authoring UI exists behind staff-publish semantics (verify promise level).

**Duplicated:** badge systems (V1 live + V2 archive), perk engine vs unlock registry, room-access predicate ×3, rep/xp type lists (intentional).

**Outside approved scope:** nothing found unapproved — the only open question is **YouTuber program** scope confirmation (fully implemented; verify it was an approved feature rather than scope creep).

**Core-value conflicts:** M-03 (kill-switch inconsistency vs Trust), M-05 (verification gap vs Accessibility), M-01/M-02/M-06 (source-of-truth divergence vs Maintainability/Auditability-of-product-intent — the registry is the documented contract and it currently lies about 5 shipped capabilities).

**Currently risky:** the perk/registry split — every future "make this unlock real" task now has two places to check, and they disagree.

**What can safely remain:** the frozen V1 ledger + reversal tooling, dormant detectors, `/ops` redirect, historical docs, seed scripts — all intentional and isolated.

**Cleanest next development sequence (from evidence, not new roadmap):**
1. M-01 reconciliation (one decision, small diff) — unblocks honest registry semantics.
2. M-03 hasUnlock routing — completes the kill-switch contract.
3. M-04 export completeness — trivial, closes a data-portability hole.
4. M-02/M-06 badge-achievement decision — prerequisite for the two achievement-gated future unlocks already in the registry.
5. M-05 browser suite — protects the P3–P5 surfaces that just shipped.
Then resume the approved roadmap (comparisons → cockpit → watch/alerts), each of which has registry rows + partial substrate already positioned.
