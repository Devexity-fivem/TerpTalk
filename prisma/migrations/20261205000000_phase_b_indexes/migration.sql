-- Phase B index changes — evidence-backed additions (EXPLAIN ANALYZE on
-- production-shaped data) and verified-subsumed removals.
--
-- Additions:
--   GrowDiary(deleted, visibility, updatedAt DESC): public diary feed
--     "WHERE deleted=false AND visibility='PUBLIC' ORDER BY updatedAt DESC"
--     went bitmap+sort 1.23ms -> index scan 0.07ms.
--   DirectMessage(receiverId, read, deleted): unread-count queries become
--     index-only scans (0.74ms -> 0.05ms).
--   ProgressionEvent(userId, type, createdAt): per-user per-type window
--     checks replace a BitmapAnd of two single-column indexes
--     (0.51ms -> 0.20ms).
--   Notification(link): account-cleanup "DELETE ... WHERE link=" no longer
--     seq-scans the whole table (19.2ms -> 0.07ms).
--
-- Removals (each fully subsumed by another index or unreferenced):
--   Thread_slug_idx        — Thread.slug is @unique (Thread_slug_key).
--   Post_threadId_idx      — leftmost prefix of (threadId, createdAt).
--   Notification_userId_idx — leftmost prefix of (userId,read),
--                             (userId,createdAt), (userId,groupKey).
--   Notification_read_idx  — bare boolean column; every real query is
--                             userId-scoped, so this index can never win.

CREATE INDEX "GrowDiary_deleted_visibility_updatedAt_idx" ON "GrowDiary"("deleted", "visibility", "updatedAt" DESC);
CREATE INDEX "DirectMessage_receiverId_read_deleted_idx" ON "DirectMessage"("receiverId", "read", "deleted");
CREATE INDEX "ProgressionEvent_userId_type_createdAt_idx" ON "ProgressionEvent"("userId", "type", "createdAt");
CREATE INDEX "Notification_link_idx" ON "Notification"("link");

DROP INDEX "Thread_slug_idx";
DROP INDEX "Post_threadId_idx";
DROP INDEX "Notification_userId_idx";
DROP INDEX "Notification_read_idx";
