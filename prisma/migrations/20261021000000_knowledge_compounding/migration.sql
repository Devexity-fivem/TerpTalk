-- Knowledge Compounding MVP — additive only, no existing rows rewritten.
-- New nullable relations use ON DELETE SET NULL so removing a strain, setup,
-- or thread never orphans or cascades into diaries.

-- AlterTable
ALTER TABLE "GrowDiary" ADD COLUMN     "strainId" TEXT,
ADD COLUMN     "mediumType" TEXT,
ADD COLUMN     "lightType" TEXT,
ADD COLUMN     "techniques" TEXT[],
ADD COLUMN     "setupId" TEXT,
ADD COLUMN     "threadId" TEXT,
ADD COLUMN     "harvestRating" INTEGER,
ADD COLUMN     "harvestDifficulty" TEXT,
ADD COLUMN     "harvestNotes" TEXT;

-- AlterTable
ALTER TABLE "DiaryUpdate" ADD COLUMN     "heightCm" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Thread" ADD COLUMN     "wizardResultId" TEXT;

-- CreateIndex
CREATE INDEX "GrowDiary_strainId_idx" ON "GrowDiary"("strainId");

-- CreateIndex
CREATE INDEX "GrowDiary_setupId_idx" ON "GrowDiary"("setupId");

-- CreateIndex
CREATE INDEX "GrowDiary_mediumType_idx" ON "GrowDiary"("mediumType");

-- CreateIndex
CREATE UNIQUE INDEX "GrowDiary_threadId_key" ON "GrowDiary"("threadId");

-- CreateIndex
CREATE INDEX "Thread_wizardResultId_idx" ON "Thread"("wizardResultId");

-- AddForeignKey
ALTER TABLE "GrowDiary" ADD CONSTRAINT "GrowDiary_strainId_fkey" FOREIGN KEY ("strainId") REFERENCES "Strain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowDiary" ADD CONSTRAINT "GrowDiary_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "GrowSetup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowDiary" ADD CONSTRAINT "GrowDiary_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
