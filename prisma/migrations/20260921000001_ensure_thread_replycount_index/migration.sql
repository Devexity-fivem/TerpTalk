-- Ensure the Thread.replyCount index exists after migration ordering corrections
CREATE INDEX IF NOT EXISTS "Thread_replyCount_idx" ON "Thread"("replyCount");
