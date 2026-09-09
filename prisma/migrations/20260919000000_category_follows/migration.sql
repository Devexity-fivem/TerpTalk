-- Category follow / subscription model
CREATE TABLE "CategoryFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryFollow_pkey" PRIMARY KEY ("id")
);

-- Unique follow per user/category
CREATE UNIQUE INDEX "CategoryFollow_userId_categoryId_key" ON "CategoryFollow"("userId", "categoryId");

-- Indexes for lookups
CREATE INDEX "CategoryFollow_categoryId_idx" ON "CategoryFollow"("categoryId");
CREATE INDEX "CategoryFollow_userId_idx" ON "CategoryFollow"("userId");

-- Foreign keys
ALTER TABLE "CategoryFollow" ADD CONSTRAINT "CategoryFollow_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CategoryFollow" ADD CONSTRAINT "CategoryFollow_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
