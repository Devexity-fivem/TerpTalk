-- Add business profile fields to Profile
ALTER TABLE "Profile" ADD COLUMN "businessName" TEXT;
ALTER TABLE "Profile" ADD COLUMN "businessType" TEXT;
ALTER TABLE "Profile" ADD COLUMN "businessUrl" TEXT;
