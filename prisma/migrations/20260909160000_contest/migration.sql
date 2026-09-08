CREATE TABLE IF NOT EXISTS "ContestEntry" (
  "id" TEXT NOT NULL,
  "week" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "caption" TEXT,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContestEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContestEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContestEntry_userId_week_key" ON "ContestEntry"("userId", "week");
CREATE INDEX IF NOT EXISTS "ContestEntry_week_idx" ON "ContestEntry"("week");

CREATE TABLE IF NOT EXISTS "ContestVote" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContestVote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContestVote_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ContestEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContestVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContestVote_entryId_userId_key" ON "ContestVote"("entryId", "userId");
CREATE INDEX IF NOT EXISTS "ContestVote_entryId_idx" ON "ContestVote"("entryId");
