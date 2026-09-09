-- Add sessionVersion to User for JWT invalidation on password/recovery changes
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
