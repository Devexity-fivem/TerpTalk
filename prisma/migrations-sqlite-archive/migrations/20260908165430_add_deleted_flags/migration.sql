-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GrowDiary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "strain" TEXT,
    "genetics" TEXT,
    "growType" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "medium" TEXT,
    "containerSize" TEXT,
    "lighting" TEXT,
    "nutrients" TEXT,
    "equipment" TEXT,
    "spaceDimensions" TEXT,
    "authorId" TEXT NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "stage" TEXT NOT NULL DEFAULT 'GERMINATION',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GrowDiary_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GrowDiary" ("authorId", "containerSize", "createdAt", "description", "equipment", "featured", "genetics", "growType", "id", "lighting", "medium", "nutrients", "spaceDimensions", "stage", "startDate", "strain", "title", "updatedAt") SELECT "authorId", "containerSize", "createdAt", "description", "equipment", "featured", "genetics", "growType", "id", "lighting", "medium", "nutrients", "spaceDimensions", "stage", "startDate", "strain", "title", "updatedAt" FROM "GrowDiary";
DROP TABLE "GrowDiary";
ALTER TABLE "new_GrowDiary" RENAME TO "GrowDiary";
CREATE INDEX "GrowDiary_authorId_idx" ON "GrowDiary"("authorId");
CREATE INDEX "GrowDiary_strain_idx" ON "GrowDiary"("strain");
CREATE INDEX "GrowDiary_featured_idx" ON "GrowDiary"("featured");
CREATE INDEX "GrowDiary_createdAt_idx" ON "GrowDiary"("createdAt");
CREATE TABLE "new_GrowSetup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "space" TEXT,
    "tent" TEXT,
    "lighting" TEXT,
    "ventilation" TEXT,
    "fans" TEXT,
    "containers" TEXT,
    "medium" TEXT,
    "nutrients" TEXT,
    "controllers" TEXT,
    "equipment" TEXT,
    "authorId" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GrowSetup_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GrowSetup" ("authorId", "containers", "controllers", "createdAt", "description", "equipment", "fans", "id", "lighting", "medium", "nutrients", "space", "tent", "title", "updatedAt", "ventilation") SELECT "authorId", "containers", "controllers", "createdAt", "description", "equipment", "fans", "id", "lighting", "medium", "nutrients", "space", "tent", "title", "updatedAt", "ventilation" FROM "GrowSetup";
DROP TABLE "GrowSetup";
ALTER TABLE "new_GrowSetup" RENAME TO "GrowSetup";
CREATE INDEX "GrowSetup_authorId_idx" ON "GrowSetup"("authorId");
CREATE INDEX "GrowSetup_createdAt_idx" ON "GrowSetup"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
