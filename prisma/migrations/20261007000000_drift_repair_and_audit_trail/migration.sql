-- Drift repair + audit-trail hardening.
--
-- Part 1 reconciles objects that exist in the live database (applied via
-- `db push`) but were never captured in a migration: StaffApplication,
-- ChatRoom.slowModeSeconds/locked, ChatMessage.replyToId,
-- Profile.youtubeChannelUrl, Tag_slug_idx. Every statement is idempotent so
-- `migrate deploy` succeeds on the drifted DB (all no-ops) and on a fresh
-- database (objects are created).
--
-- Part 2 makes the staff audit trail survivable: ModerationAction.moderator
-- and GuideEdit.editor switch from Cascade to SetNull, with username
-- snapshots so attribution isn't lost when a staff account is deleted.
--
-- Part 3 adds Cascade user relations to Bookmark/DiaryFollow (orphan
-- cleanup) and missing hot-path indexes.

-- ── Part 1: drift repair ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "StaffApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "about" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StaffApplication_status_idx" ON "StaffApplication"("status");
CREATE INDEX IF NOT EXISTS "StaffApplication_userId_idx" ON "StaffApplication"("userId");
CREATE INDEX IF NOT EXISTS "StaffApplication_role_status_idx" ON "StaffApplication"("role", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffApplication_userId_fkey') THEN
    ALTER TABLE "StaffApplication" ADD CONSTRAINT "StaffApplication_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffApplication_reviewedBy_fkey') THEN
    ALTER TABLE "StaffApplication" ADD CONSTRAINT "StaffApplication_reviewedBy_fkey"
      FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "ChatRoom"
  ADD COLUMN IF NOT EXISTS "slowModeSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "locked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "replyToId" TEXT;
CREATE INDEX IF NOT EXISTS "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_replyToId_fkey') THEN
    ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey"
      FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "youtubeChannelUrl" TEXT;

CREATE INDEX IF NOT EXISTS "Tag_slug_idx" ON "Tag"("slug");

-- ── Part 2: survivable audit trail ──────────────────────────────────

ALTER TABLE "ModerationAction"
  ADD COLUMN IF NOT EXISTS "moderatorName" TEXT,
  ALTER COLUMN "moderatorId" DROP NOT NULL;
ALTER TABLE "GuideEdit"
  ADD COLUMN IF NOT EXISTS "editorName" TEXT,
  ALTER COLUMN "editorId" DROP NOT NULL;

-- Snapshot attribution before the FK changes (idempotent — IS NULL guard).
UPDATE "ModerationAction" ma
  SET "moderatorName" = p.username
  FROM "User" u JOIN "Profile" p ON p."userId" = u.id
  WHERE ma."moderatorId" = u.id AND ma."moderatorName" IS NULL;
UPDATE "GuideEdit" ge
  SET "editorName" = p.username
  FROM "User" u JOIN "Profile" p ON p."userId" = u.id
  WHERE ge."editorId" = u.id AND ge."editorName" IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ModerationAction_moderatorId_fkey') THEN
    ALTER TABLE "ModerationAction" DROP CONSTRAINT "ModerationAction_moderatorId_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GuideEdit_editorId_fkey') THEN
    ALTER TABLE "GuideEdit" DROP CONSTRAINT "GuideEdit_editorId_fkey";
  END IF;
END $$;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_moderatorId_fkey"
  FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuideEdit" ADD CONSTRAINT "GuideEdit_editorId_fkey"
  FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Part 3: orphan cleanup + indexes ────────────────────────────────

-- Remove rows pointing at already-deleted users so the FKs can validate.
DELETE FROM "Bookmark" b
  WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = b."userId");
DELETE FROM "DiaryFollow" d
  WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = d."userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Bookmark_userId_fkey') THEN
    ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiaryFollow_userId_fkey') THEN
    ALTER TABLE "DiaryFollow" ADD CONSTRAINT "DiaryFollow_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Thread_views_idx" ON "Thread"("views");
CREATE INDEX IF NOT EXISTS "Thread_lastActivityAt_idx" ON "Thread"("lastActivityAt");
CREATE INDEX IF NOT EXISTS "Report_targetId_idx" ON "Report"("targetId");

-- These exist in the drifted DB as ASC indexes; the schema wants DESC for
-- hot sorted reads. Drop + recreate so both paths converge on DESC.
DROP INDEX IF EXISTS "Profile_reputation_idx";
CREATE INDEX "Profile_reputation_idx" ON "Profile"("reputation" DESC);
DROP INDEX IF EXISTS "User_lastSeenAt_idx";
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt" DESC);
DROP INDEX IF EXISTS "GrowDiary_harvested_harvestedAt_idx";
CREATE INDEX "GrowDiary_harvested_harvestedAt_idx" ON "GrowDiary"("harvested", "harvestedAt" DESC);

-- ── Part 4: staff reversals are final ────────────────────────────────
-- reversalFinal marks staff-initiated reversals so a keyed re-trigger
-- (re-like, re-accept, challenge re-check) cannot silently reinstate a
-- moderation decision.
ALTER TABLE "ReputationEvent" ADD COLUMN IF NOT EXISTS "reversalFinal" BOOLEAN NOT NULL DEFAULT false;
