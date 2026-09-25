-- Slice B: structured nutrient rows on DiaryUpdate.
-- Additive only — new table, no backfill, no changes to existing rows.

CREATE TABLE "DiaryUpdateNutrient" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "doseMlPerL" DOUBLE PRECISION,

    CONSTRAINT "DiaryUpdateNutrient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiaryUpdateNutrient_updateId_productName_key" ON "DiaryUpdateNutrient"("updateId", "productName");
CREATE INDEX "DiaryUpdateNutrient_updateId_idx" ON "DiaryUpdateNutrient"("updateId");
CREATE INDEX "DiaryUpdateNutrient_productName_idx" ON "DiaryUpdateNutrient"("productName");

ALTER TABLE "DiaryUpdateNutrient" ADD CONSTRAINT "DiaryUpdateNutrient_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "DiaryUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
