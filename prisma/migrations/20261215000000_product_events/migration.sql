-- CreateTable
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "source" TEXT,
    "objectType" TEXT,
    "objectId" TEXT,
    "key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductEvent_key_key" ON "ProductEvent"("key");

-- CreateIndex
CREATE INDEX "ProductEvent_type_createdAt_idx" ON "ProductEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ProductEvent_userId_idx" ON "ProductEvent"("userId");
