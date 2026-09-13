-- Reputation 2.1 — progression cosmetics + badge showcase + perf indexes.
-- Idempotent: every statement is safe to re-run.

-- Equipped cosmetics on Profile (registry keys from lib/cosmetics.ts).
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "avatarFrame" TEXT;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "profileTitle" TEXT;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "profileTheme" TEXT;

-- Pinned/showcased badges on the profile card.
ALTER TABLE "UserBadge" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;

-- Tier rename: Seedling -> Rooted. Renames the Badge row itself so all
-- existing UserBadge assignments carry over; seedBadges() keeps it in sync.
UPDATE "Badge"
SET "name" = 'Rooted',
    "description" = 'Reached 750 reputation.',
    "icon" = 'Leaf',
    "requirement" = 'Earn 750 reputation.'
WHERE "name" = 'Seedling';

-- Indexes: member-number count (User.createdAt), strain-author lookups,
-- and the per-type daily-cap count used by every reputation award.
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX IF NOT EXISTS "Strain_createdById_idx" ON "Strain"("createdById");
CREATE INDEX IF NOT EXISTS "ReputationEvent_userId_type_createdAt_idx" ON "ReputationEvent"("userId", "type", "createdAt");
