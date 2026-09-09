-- Add accepted-answer relation to Thread
ALTER TABLE "Thread" ADD COLUMN "acceptedAnswerId" TEXT;

-- Foreign key to Post with SET NULL on delete (if the answer is deleted, the thread remains)
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_acceptedAnswerId_fkey"
  FOREIGN KEY ("acceptedAnswerId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ensure a post can only be the accepted answer of one thread
CREATE UNIQUE INDEX "Thread_acceptedAnswerId_key" ON "Thread"("acceptedAnswerId");
