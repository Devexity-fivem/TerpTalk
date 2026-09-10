-- Images attached to a thread's opening post or to a reply.
-- Exactly one of threadId/postId is set, mirroring Reaction's post/diary split.
CREATE TABLE "PostImage" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "threadId" TEXT,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostImage_pkey" PRIMARY KEY ("id")
);

-- Indexes for gallery lookups
CREATE INDEX "PostImage_threadId_idx" ON "PostImage"("threadId");
CREATE INDEX "PostImage_postId_idx" ON "PostImage"("postId");

-- Foreign keys
ALTER TABLE "PostImage" ADD CONSTRAINT "PostImage_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PostImage" ADD CONSTRAINT "PostImage_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
