-- TerpBot session concurrency — optimistic CAS token. saveSession
-- writes deltas via updateMany { userId, version } so concurrent
-- commands merge append-only state instead of last-writer-wins.
ALTER TABLE "BotSession" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
