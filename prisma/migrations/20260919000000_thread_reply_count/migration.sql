-- Add denormalized reply count to Thread for unanswered filters
ALTER TABLE "Thread" ADD COLUMN "replyCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Thread_replyCount_idx" ON "Thread"("replyCount");
