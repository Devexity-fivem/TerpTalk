# TerpTalk Trust & Safety Workqueue

One place for staff to answer: **what needs attention, why, what evidence exists, and what happened after review.**

Automation detects and flags. Humans decide. Nothing in this system autonomously punishes a member.

## Queue model

The queue is a **federated union** of two persisted entities — no shadow case table:

| Kind | Entity | Source |
|---|---|---|
| `REPORT` | `Report` | Members via `POST /api/reports` |
| `FLAG` | `AbuseFlag` | Automated detectors (`src/lib/trust-signals.ts`) |

Each entity owns its own lifecycle: `status` (PENDING / REVIEWING / ESCALATED / RESOLVED / DISMISSED), `priority` (LOW / NORMAL / HIGH / URGENT), `assignedToId`, `resolvedById`, `resolvedAt`, `resolution`.

## Priority

Derived deterministically — users cannot manipulate it:

- Reports: `URGENT` for THREATS / ILLEGAL_CONTENT, `HIGH` for HARASSMENT / SCAM / MALICIOUS_LINKS, `NORMAL` otherwise. Backfilled on existing rows at migration.
- Flags: `HIGH` for REP_VELOCITY, `NORMAL` for pair/new-account signals.
- Staff (MODERATOR+) can override priority via the case page; the override writes a `*_PRIORITY` audit row.
- Queue ordering: priority rank, then oldest first.

## Abuse signals

Detectors (`detectReputationSignals`) run raw-SQL scans over the reputation ledger:

- `REP_VELOCITY` — >150 reputation gained in 24h.
- `REP_RECIPROCAL_PAIR` — two accounts with ≥5 mutual like-awards in the window.
- `REP_NEW_ACCOUNT_LIKES` — ≥5 likes from accounts <48h old toward one recipient.

`materializeReputationFlags()` upserts hits into `AbuseFlag` keyed by a per-day dedupe token (`repvel:<user>:<date>`, `reprec:<a>:<b>:<date>`, `repnew:<user>:<date>`) so re-scans are idempotent and each flag freezes an `evidence` snapshot that survives later reversals. It runs:

1. Inside the daily cron (`safety:signal-scan:<date>` Setting key in `api/cron/terpbot` — a system task, not a TerpBot capability).
2. Upsert-on-read in `GET /api/admin/reputation/flags`.

New flags notify MODERATOR+ADMINISTRATOR via `MODERATOR_ANNOUNCEMENT`. Signals are evidence, not proof.

## API

| Route | Access | Purpose |
|---|---|---|
| `GET /api/moderation/queue` | staff | Unified list. Filters: `status` (OPEN default / PENDING / REVIEWING / ESCALATED / RESOLVED / DISMISSED / ALL), `kind`, `mine`, `unassigned`, `priority`, `type`, `q` (subject username), `page`, `limit`. Returns `counts {open, mine, escalated}`. |
| `GET /api/moderation/queue/[id]?kind=` | staff | Case detail: evidence, subject context, related open cases, audit activity. |
| `PATCH /api/moderation/queue` | staff* | `{kind, id, action}` — `status` / `assign` / `priority`. |
| `POST /api/moderation/queue/bulk` | mod+ | `{items[], action: resolve\|dismiss\|assign, assignTo?}` — max 50, per-item audit, partial-failure report. |
| `GET /api/moderation/queue/staff` | mod+ | Assignee roster. |

\* SUPPORT may only transition cases to REVIEWING or ESCALATED. Terminal states, assignment, and priority overrides require MODERATOR+.

## Permissions

| Capability | SUPPORT | MODERATOR | ADMINISTRATOR |
|---|---|---|---|
| View queue / case detail | ✅ (reporter masked, summary-only subject context) | ✅ | ✅ |
| Triage → REVIEWING / ESCALATED | ✅ | ✅ | ✅ |
| Resolve / dismiss / assign / priority | ❌ | ✅ | ✅ |
| Bulk lifecycle actions | ❌ | ✅ | ✅ |
| Enforcement (warn / remove content / ban) | ❌ | via existing routes | via existing routes |
| Reverse STAFF_ADJUSTMENT / manual ±rep | ❌ | ❌ | ✅ |

Additional guards:

- Staff cannot adjudicate reports they filed themselves.
- Reporter username is hidden from SUPPORT in the queue, reports list, and case detail.
- SUPPORT subject context omits suspension state, presence, rep history, and mod history.
- Escalating a case notifies all administrators; assigning notifies the assignee.
- Every transition writes `ModerationAction` (`REPORT_*` / `FLAG_*` rows linked via `reportId`/`flagId`) plus a `SecurityEvent`.

## Enforcement

The workqueue never duplicates enforcement logic. Case pages link into the existing routes:

- `POST /api/moderation/actions` — warnings, content deletion, bans (role-gated as before).
- `POST /api/moderation/reputation` — event reversal (mod+; STAFF_ADJUSTMENT reversal is admin-only).
- `POST /api/admin/reputation` — bounded ±500 adjustments (admin only).

Bulk is restricted to lifecycle actions (resolve / dismiss / assign). There is deliberately no bulk enforcement.

## TerpBot boundary

TerpBot has **no** workqueue integration. It never reads `Report`, `AbuseFlag`, or `SecurityEvent`; it cannot take moderation actions; it stays out of staff notifications. The daily signal scan is a plain cron task sharing the cron route — not a bot capability. The boundary contract in `src/lib/terpbot.ts` is unchanged.

## Audit trail

- Case lifecycle: `Report` / `AbuseFlag` fields (`status`, `resolvedById`, `resolvedAt`, `resolution`).
- Staff actions: `ModerationAction` rows with `reportId`/`flagId` linkage — surfaced as "Case activity" on the case page.
- Security context: `SecurityEvent` `SUSPICIOUS_ACTIVITY` entries with `caseId` metadata.
- Reputation effects remain in the `ReputationEvent` ledger (reversible, per `REPUTATION.md`).

## Performance

- Queue list: bounded per-source fetch (≤500), merged in memory, sorted by priority then age, offset pagination (default 50, max 100).
- Indexes: `Report(status, createdAt)`, `Report(reportedId)`, `Report(assignedToId, status)`, same pattern on `AbuseFlag`; `ModerationAction(reportId)`, `ModerationAction(flagId)`.
- Target previews are batch-resolved by type (one `findMany` per entity type), usernames resolved in a single query — no N+1 fan-out.
- Staff endpoints are never cached and are rate-limited (30/min reads+mutations, bulk 30/10min).

## Testing

`npm run test:trust-safety` (requires dev server): 58 checks covering the role matrix, reporter privacy, state transitions, self-adjudication, flag lifecycle, bulk bounds and partial failures, IDOR, admin reputation endpoints, and rate limiting.
