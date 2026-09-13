-- Reputation 2.0: extend ReputationEvent into a proper ledger, denormalize
-- contest-vote periods for real uniqueness, add milestone notification pref,
-- and reconcile historical balances with idempotent LEGACY_MIGRATION rows.

ALTER TABLE "ReputationEvent"
  ADD COLUMN "key" TEXT,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "actorId" TEXT,
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversalOfId" TEXT;

CREATE UNIQUE INDEX "ReputationEvent_key_key" ON "ReputationEvent"("key");
DROP INDEX IF EXISTS "ReputationEvent_userId_idx";
CREATE INDEX "ReputationEvent_userId_createdAt_idx" ON "ReputationEvent"("userId", "createdAt");
CREATE INDEX "ReputationEvent_sourceType_sourceId_idx" ON "ReputationEvent"("sourceType", "sourceId");
CREATE INDEX "ReputationEvent_actorId_idx" ON "ReputationEvent"("actorId");
CREATE INDEX "ReputationEvent_reversalOfId_idx" ON "ReputationEvent"("reversalOfId");
CREATE INDEX "ReputationEvent_type_createdAt_idx" ON "ReputationEvent"("type", "createdAt");

-- Contest votes: copy the period from the parent entry, drop duplicates a
-- race could have created (keep the earliest), then enforce one vote per
-- user per period.
ALTER TABLE "ContestVote" ADD COLUMN "week" TEXT NOT NULL DEFAULT '';
UPDATE "ContestVote" v SET "week" = e."week" FROM "ContestEntry" e WHERE v."entryId" = e."id";
DELETE FROM "ContestVote" WHERE "id" NOT IN (
  SELECT MIN("id") FROM "ContestVote" GROUP BY "userId", "week"
);
CREATE UNIQUE INDEX "ContestVote_userId_week_key" ON "ContestVote"("userId", "week");

ALTER TABLE "DiaryContestVote" ADD COLUMN "month" TEXT NOT NULL DEFAULT '';
UPDATE "DiaryContestVote" v SET "month" = e."month" FROM "DiaryContestEntry" e WHERE v."entryId" = e."id";
DELETE FROM "DiaryContestVote" WHERE "id" NOT IN (
  SELECT MIN("id") FROM "DiaryContestVote" GROUP BY "userId", "month"
);
CREATE UNIQUE INDEX "DiaryContestVote_userId_month_key" ON "DiaryContestVote"("userId", "month");

ALTER TABLE "Profile" ADD COLUMN "notifyOnMilestone" BOOLEAN NOT NULL DEFAULT true;

-- Reconciliation: for every profile whose ledger sum doesn't match its
-- balance, insert one carry-over row keyed 'legacy:<userId>' so the
-- invariant (balance == SUM(unreversed amount)) holds. Historical rows
-- predate provenance columns, so this bridges rather than fabricates.
-- Idempotent: the unique key makes a re-run a no-op per user.
INSERT INTO "ReputationEvent" ("id", "type", "userId", "amount", "reason", "key")
SELECT
  'legmig_' || p."userId",
  'LEGACY_MIGRATION',
  p."userId",
  p."reputation" - COALESCE(s.total, 0),
  'Reputation balance carried over from before the ledger',
  'legacy:' || p."userId"
FROM "Profile" p
LEFT JOIN (
  SELECT "userId", SUM("amount") AS total
  FROM "ReputationEvent"
  WHERE "reversedAt" IS NULL
  GROUP BY "userId"
) s ON s."userId" = p."userId"
WHERE p."reputation" <> COALESCE(s.total, 0)
ON CONFLICT ("key") DO NOTHING;
