-- CreateTable
CREATE TABLE "DiaryContestEntry" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "diaryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiaryContestEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiaryContestVote" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiaryContestVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiaryContestEntry_month_idx" ON "DiaryContestEntry"("month");

-- CreateIndex
CREATE UNIQUE INDEX "DiaryContestEntry_userId_month_key" ON "DiaryContestEntry"("userId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "DiaryContestEntry_diaryId_month_key" ON "DiaryContestEntry"("diaryId", "month");

-- CreateIndex
CREATE INDEX "DiaryContestVote_entryId_idx" ON "DiaryContestVote"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "DiaryContestVote_entryId_userId_key" ON "DiaryContestVote"("entryId", "userId");

-- CreateIndex
CREATE INDEX "DiaryUpdate_diaryId_createdAt_idx" ON "DiaryUpdate"("diaryId", "createdAt");

-- AddForeignKey
ALTER TABLE "DiaryContestEntry" ADD CONSTRAINT "DiaryContestEntry_diaryId_fkey" FOREIGN KEY ("diaryId") REFERENCES "GrowDiary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiaryContestEntry" ADD CONSTRAINT "DiaryContestEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiaryContestVote" ADD CONSTRAINT "DiaryContestVote_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DiaryContestEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiaryContestVote" ADD CONSTRAINT "DiaryContestVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
