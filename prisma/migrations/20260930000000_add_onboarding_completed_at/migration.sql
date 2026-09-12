-- Add onboardingCompletedAt to User. null = onboarding not yet completed;
-- timestamp = onboarding finished or dismissed. Existing accounts are
-- backfilled as already-completed so they are never sent through onboarding.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);
UPDATE "User" SET "onboardingCompletedAt" = NOW() WHERE "onboardingCompletedAt" IS NULL;
