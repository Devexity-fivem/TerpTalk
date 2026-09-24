-- Operator change/experiment log. Lets the founder answer "what changed
-- here?" when activation or retention numbers move. Admin-written only.
CREATE TABLE "ProductChange" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CHANGE',
    "title" TEXT NOT NULL,
    "surface" TEXT,
    "hypothesis" TEXT,
    "description" TEXT NOT NULL,
    "primaryMetric" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "result" TEXT,
    "conclusion" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ProductChange_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductChange" ADD CONSTRAINT "ProductChange_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProductChange_createdAt_idx" ON "ProductChange"("createdAt");
CREATE INDEX "ProductChange_status_idx" ON "ProductChange"("status");
