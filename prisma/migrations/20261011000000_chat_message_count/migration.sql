-- Persistent lifetime chat-message counter. ChatMessage rows are pruned
-- after 3 days and soft-deleted by room clears, so badge progress derived
-- from live rows kept resetting. Backfill counts every surviving message.
ALTER TABLE "Profile"
ADD COLUMN IF NOT EXISTS "chatMessageCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "Profile" p
SET "chatMessageCount" = (
  SELECT COUNT(*) FROM "ChatMessage" m WHERE m."authorId" = p."userId"
);
