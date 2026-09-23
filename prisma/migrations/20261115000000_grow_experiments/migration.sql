-- AlterTable
ALTER TABLE "DiaryUpdate" ADD COLUMN     "experimentId" TEXT;

-- AlterTable
ALTER TABLE "GrowDiary" ADD COLUMN     "lessons" JSONB;

-- CreateTable
CREATE TABLE "GrowExperiment" (
    "id" TEXT NOT NULL,
    "diaryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "reason" TEXT,
    "expected" TEXT,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "outcome" TEXT,
    "conclusion" TEXT,
    "baseline" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrowExperiment_diaryId_idx" ON "GrowExperiment"("diaryId");

-- CreateIndex
CREATE INDEX "GrowExperiment_authorId_idx" ON "GrowExperiment"("authorId");

-- CreateIndex
CREATE INDEX "GrowExperiment_diaryId_status_idx" ON "GrowExperiment"("diaryId", "status");

-- CreateIndex
CREATE INDEX "DiaryUpdate_experimentId_idx" ON "DiaryUpdate"("experimentId");

-- AddForeignKey
ALTER TABLE "DiaryUpdate" ADD CONSTRAINT "DiaryUpdate_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "GrowExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowExperiment" ADD CONSTRAINT "GrowExperiment_diaryId_fkey" FOREIGN KEY ("diaryId") REFERENCES "GrowDiary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrowExperiment" ADD CONSTRAINT "GrowExperiment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
