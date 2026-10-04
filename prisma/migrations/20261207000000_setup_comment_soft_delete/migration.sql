-- SetupComment soft-delete — additive only, no existing rows rewritten.
-- Moderated/reported comments must remain auditable (Batch R): the new
-- flag defaults to false so every existing comment stays visible, and
-- the member-speech convention (Thread/Post/ChatMessage/Diary all carry
-- a soft-delete flag) is preserved.

-- AlterTable
ALTER TABLE "SetupComment" ADD COLUMN     "deleted" BOOLEAN NOT NULL DEFAULT false;
