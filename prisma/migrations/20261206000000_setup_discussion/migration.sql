-- Setup Discussion — additive only, no existing rows rewritten.
-- Nullable 0-1 canonical discussion thread per GrowSetup, mirroring
-- GrowDiary.threadId. ON DELETE SET NULL keeps setups valid when their
-- discussion thread is deleted; the column defaults to NULL for all
-- existing rows and Postgres treats NULLs as distinct under UNIQUE,
-- so the constraint is safe on existing data.

-- AlterTable
ALTER TABLE "GrowSetup" ADD COLUMN     "threadId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GrowSetup_threadId_key" ON "GrowSetup"("threadId");

-- AddForeignKey
ALTER TABLE "GrowSetup" ADD CONSTRAINT "GrowSetup_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
