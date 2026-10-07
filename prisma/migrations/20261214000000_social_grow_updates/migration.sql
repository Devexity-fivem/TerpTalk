-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "diaryUpdateId" TEXT;

-- AlterTable
ALTER TABLE "Reaction" ADD COLUMN     "diaryUpdateId" TEXT;

-- CreateIndex
CREATE INDEX "Post_diaryUpdateId_createdAt_idx" ON "Post"("diaryUpdateId", "createdAt");

-- CreateIndex
CREATE INDEX "Reaction_diaryUpdateId_idx" ON "Reaction"("diaryUpdateId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_userId_diaryUpdateId_key" ON "Reaction"("userId", "diaryUpdateId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_diaryUpdateId_fkey" FOREIGN KEY ("diaryUpdateId") REFERENCES "DiaryUpdate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_diaryUpdateId_fkey" FOREIGN KEY ("diaryUpdateId") REFERENCES "DiaryUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

