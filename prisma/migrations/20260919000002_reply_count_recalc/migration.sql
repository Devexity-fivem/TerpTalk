-- Recompute denormalized Thread.replyCount from actual non-deleted posts
UPDATE "Thread"
SET "replyCount" = GREATEST(0, (
  SELECT COUNT(*) FROM "Post"
  WHERE "Post"."threadId" = "Thread".id AND "Post".deleted = false
) - 1);
