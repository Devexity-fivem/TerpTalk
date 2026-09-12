-- Notification 2.0: actor attribution, grouping/dedupe key, structured metadata,
-- and new notification preferences. Fully additive — no existing data is altered.

ALTER TABLE "Notification" ADD COLUMN "actorId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "groupKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN "metadata" JSONB;

ALTER TABLE "Profile" ADD COLUMN "notifyOnFollow" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "notifyOnReaction" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_actorId_idx" ON "Notification"("actorId");
CREATE INDEX "Notification_userId_groupKey_idx" ON "Notification"("userId", "groupKey");
