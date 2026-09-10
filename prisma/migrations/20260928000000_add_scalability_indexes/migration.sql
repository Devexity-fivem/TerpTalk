-- Add indexes to support high-traffic public pages and sorting
CREATE INDEX IF NOT EXISTS "Profile_reputation_idx" ON "Profile" ("reputation" DESC);
CREATE INDEX IF NOT EXISTS "User_lastSeenAt_idx" ON "User" ("lastSeenAt" DESC);

-- Enable trigram search for case-insensitive substring matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes to speed up title/body search queries
CREATE INDEX IF NOT EXISTS "Thread_title_trgm_idx" ON "Thread" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Thread_content_trgm_idx" ON "Thread" USING gin ("content" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Post_content_trgm_idx" ON "Post" USING gin ("content" gin_trgm_ops);
