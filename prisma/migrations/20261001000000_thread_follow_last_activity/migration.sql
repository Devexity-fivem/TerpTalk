-- Thread.lastActivityAt: bumped only when a new reply lands (updatedAt is
-- polluted by view increments and can't drive unread indicators).
ALTER TABLE "Thread" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill from the newest non-deleted post (or the thread's own creation).
UPDATE "Thread" t
SET "lastActivityAt" = GREATEST(
  t."createdAt",
  COALESCE((
    SELECT MAX(p."createdAt") FROM "Post" p
    WHERE p."threadId" = t."id" AND p."deleted" = false
  ), t."createdAt")
);

-- ThreadFollow: followed threads — drives throttled reply notifications
-- (lastNotifiedAt) and unread indicators (lastSeenAt vs lastActivityAt).
CREATE TABLE IF NOT EXISTS "ThreadFollow" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3),
  "lastNotifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ThreadFollow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ThreadFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ThreadFollow_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ThreadFollow_userId_threadId_key" ON "ThreadFollow"("userId", "threadId");
CREATE INDEX IF NOT EXISTS "ThreadFollow_threadId_idx" ON "ThreadFollow"("threadId");
CREATE INDEX IF NOT EXISTS "ThreadFollow_userId_idx" ON "ThreadFollow"("userId");
