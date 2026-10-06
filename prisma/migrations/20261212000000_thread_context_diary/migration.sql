-- AlterTable
ALTER TABLE "Thread" ADD COLUMN "contextDiaryId" TEXT;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_contextDiaryId_fkey" FOREIGN KEY ("contextDiaryId") REFERENCES "GrowDiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Thread_contextDiaryId_idx" ON "Thread"("contextDiaryId");
