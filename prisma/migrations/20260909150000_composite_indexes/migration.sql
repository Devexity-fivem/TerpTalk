-- Composite indexes for the hottest read paths
CREATE INDEX IF NOT EXISTS "ChatMessage_roomId_createdAt_idx" ON "ChatMessage"("roomId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_read_idx" ON "Notification"("userId", "read");
CREATE INDEX IF NOT EXISTS "DirectMessage_senderId_receiverId_idx" ON "DirectMessage"("senderId", "receiverId");
CREATE INDEX IF NOT EXISTS "Post_threadId_createdAt_idx" ON "Post"("threadId", "createdAt");
