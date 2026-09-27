-- Progression V2 schema: dual-currency ledger, mastery cache, achievements,
-- XP reversal outbox. Additive only — legacy ReputationEvent/PendingReversal/
-- Badge/UserBadge untouched; Profile.reputation retained (frozen at cutover).

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "legacyVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "standing" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unlockFrozen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProgressionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mastery" TEXT,
    "type" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "standing" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "key" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "actorId" TEXT,
    "meta" JSONB,
    "reversedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "reversalFinal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasteryProgress" (
    "userId" TEXT NOT NULL,
    "mastery" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasteryProgress_pkey" PRIMARY KEY ("userId","mastery")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    "spec" JSONB,
    "unlocks" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingXpReversal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventKey" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingXpReversal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProgressionEvent_key_key" ON "ProgressionEvent"("key");

-- CreateIndex
CREATE INDEX "ProgressionEvent_userId_createdAt_idx" ON "ProgressionEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressionEvent_userId_mastery_createdAt_idx" ON "ProgressionEvent"("userId", "mastery", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressionEvent_sourceType_sourceId_idx" ON "ProgressionEvent"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ProgressionEvent_actorId_idx" ON "ProgressionEvent"("actorId");

-- CreateIndex
CREATE INDEX "ProgressionEvent_reversalOfId_idx" ON "ProgressionEvent"("reversalOfId");

-- CreateIndex
CREATE INDEX "ProgressionEvent_type_createdAt_idx" ON "ProgressionEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressionEvent_createdAt_idx" ON "ProgressionEvent"("createdAt");

-- CreateIndex
CREATE INDEX "MasteryProgress_mastery_xp_idx" ON "MasteryProgress"("mastery", "xp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement"("key");

-- CreateIndex
CREATE INDEX "Achievement_key_idx" ON "Achievement"("key");

-- CreateIndex
CREATE INDEX "Achievement_family_idx" ON "Achievement"("family");

-- CreateIndex
CREATE INDEX "UserAchievement_userId_idx" ON "UserAchievement"("userId");

-- CreateIndex
CREATE INDEX "UserAchievement_achievementId_idx" ON "UserAchievement"("achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "PendingXpReversal_status_createdAt_idx" ON "PendingXpReversal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Profile_xp_idx" ON "Profile"("xp" DESC);

-- CreateIndex
CREATE INDEX "Profile_standing_idx" ON "Profile"("standing" DESC);

-- AddForeignKey
ALTER TABLE "ProgressionEvent" ADD CONSTRAINT "ProgressionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasteryProgress" ADD CONSTRAINT "MasteryProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
