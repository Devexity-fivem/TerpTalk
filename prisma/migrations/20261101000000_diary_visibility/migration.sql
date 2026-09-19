ALTER TABLE "GrowDiary" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC';
CREATE INDEX "GrowDiary_visibility_idx" ON "GrowDiary"("visibility");
