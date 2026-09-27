-- Garden Perks: profile cosmetics removed; pinned harvest + deals gating added.

-- Drop the retired cosmetic columns.
ALTER TABLE "Profile" DROP COLUMN IF EXISTS "avatarFrame";
ALTER TABLE "Profile" DROP COLUMN IF EXISTS "profileTitle";
ALTER TABLE "Profile" DROP COLUMN IF EXISTS "profileTheme";

-- Pinned harvest — the member's chosen finished grow (SetNull on diary delete).
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "pinnedDiaryId" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Profile_pinnedDiaryId_fkey'
  ) THEN
    ALTER TABLE "Profile"
      ADD CONSTRAINT "Profile_pinnedDiaryId_fkey"
      FOREIGN KEY ("pinnedDiaryId") REFERENCES "GrowDiary"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Profile_pinnedDiaryId_idx" ON "Profile"("pinnedDiaryId");

-- Members-only deals gating.
ALTER TABLE "AffiliateProduct" ADD COLUMN IF NOT EXISTS "minRank" TEXT;
ALTER TABLE "AffiliateProduct" ADD COLUMN IF NOT EXISTS "publicAt" TIMESTAMP(3);
