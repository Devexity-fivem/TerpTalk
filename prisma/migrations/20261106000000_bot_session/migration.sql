-- TerpBot continuity — one expiring row per user holding the bounded
-- session state (reported measurements, structured observations, last
-- /why trail). Never stores message text, room ids, or diary content.
CREATE TABLE "BotSession" (
    "userId" TEXT NOT NULL,
    "diaryId" TEXT,
    "knowledgeVersion" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "pendingAsk" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "BotSession_expiresAt_idx" ON "BotSession"("expiresAt");

ALTER TABLE "BotSession" ADD CONSTRAINT "BotSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
