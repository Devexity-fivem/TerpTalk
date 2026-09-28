-- Profile V2 foundation — additive only.
-- Profile.featuredDiaryId: member-controlled featured grow (SetNull on diary delete).
-- Profile.profileSettings: validated customization JSON blob (lib/profile-settings.ts).
-- ProfileCustomSection: member-authored markdown sections (PUBLIC|MEMBERS|HIDDEN).

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "featuredDiaryId" TEXT,
ADD COLUMN     "profileSettings" JSONB;

-- CreateTable
CREATE TABLE "ProfileCustomSection" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileCustomSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileCustomSection_profileId_order_idx" ON "ProfileCustomSection"("profileId", "order");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_featuredDiaryId_fkey" FOREIGN KEY ("featuredDiaryId") REFERENCES "GrowDiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileCustomSection" ADD CONSTRAINT "ProfileCustomSection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
