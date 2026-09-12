-- CreateTable
CREATE TABLE "BotEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT,
    "command" TEXT,
    "entities" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotEvent_key_key" ON "BotEvent"("key");

-- CreateIndex
CREATE INDEX "BotEvent_type_createdAt_idx" ON "BotEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "BotEvent_userId_idx" ON "BotEvent"("userId");
