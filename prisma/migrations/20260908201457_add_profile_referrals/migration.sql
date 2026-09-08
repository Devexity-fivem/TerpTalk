-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "referredById" TEXT;

-- CreateIndex
CREATE INDEX "Profile_referredById_idx" ON "Profile"("referredById");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
