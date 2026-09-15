-- Reputation-gated chat rooms (the Grow Room). Nullable — null means open
-- to all signed-in members; isPrivate keeps its existing staff-only meaning.
ALTER TABLE "ChatRoom" ADD COLUMN IF NOT EXISTS "requiredRep" INTEGER;
