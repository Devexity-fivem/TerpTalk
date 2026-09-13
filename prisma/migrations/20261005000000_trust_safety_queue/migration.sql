-- Trust & Safety workqueue: triage metadata on Report, persisted AbuseFlag
-- records for detector output, and case linkage on ModerationAction.

ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "resolvedById" TEXT;
ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);

ALTER TABLE "ModerationAction" ADD COLUMN IF NOT EXISTS "reportId" TEXT;
ALTER TABLE "ModerationAction" ADD COLUMN IF NOT EXISTS "flagId" TEXT;

CREATE TABLE IF NOT EXISTS "AbuseFlag" (
    "id" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "key" TEXT NOT NULL,
    "evidence" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "resolution" TEXT,
    "assignedToId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbuseFlag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AbuseFlag_key_key" ON "AbuseFlag"("key");
CREATE INDEX IF NOT EXISTS "AbuseFlag_status_createdAt_idx" ON "AbuseFlag"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "AbuseFlag_userId_idx" ON "AbuseFlag"("userId");
CREATE INDEX IF NOT EXISTS "AbuseFlag_assignedToId_status_idx" ON "AbuseFlag"("assignedToId", "status");

CREATE INDEX IF NOT EXISTS "Report_status_createdAt_idx" ON "Report"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Report_reportedId_idx" ON "Report"("reportedId");
CREATE INDEX IF NOT EXISTS "Report_assignedToId_status_idx" ON "Report"("assignedToId", "status");

CREATE INDEX IF NOT EXISTS "ModerationAction_reportId_idx" ON "ModerationAction"("reportId");
CREATE INDEX IF NOT EXISTS "ModerationAction_flagId_idx" ON "ModerationAction"("flagId");

-- Backfill derived priority on existing reports from their reason.
UPDATE "Report" SET "priority" = 'URGENT' WHERE "reason" IN ('THREATS', 'ILLEGAL_CONTENT') AND "priority" = 'NORMAL';
UPDATE "Report" SET "priority" = 'HIGH' WHERE "reason" IN ('HARASSMENT', 'SCAM', 'MALICIOUS_LINKS') AND "priority" = 'NORMAL';
