-- Notification preferences on Profile
ALTER TABLE "Profile" ADD COLUMN "notifyOnReply" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "notifyOnMention" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "notifyOnCategoryFollow" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Profile" ADD COLUMN "emailDigestFrequency" TEXT;
