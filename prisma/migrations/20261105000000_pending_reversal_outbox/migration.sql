-- Durable reputation-reversal outbox. The intent row is written inside the
-- same transaction as the triggering delete/ban so a reversal can be delayed
-- but never silently lost. Drained post-commit, throttled from /api/ping,
-- and swept by daily cron. All ids are bare strings (no FKs) so account
-- deletion never orphans or blocks rows.
CREATE TABLE "PendingReversal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventKey" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingReversal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingReversal_status_createdAt_idx" ON "PendingReversal"("status", "createdAt");
