-- ModerationAction target identity — additive only, no existing rows rewritten.
-- New audit rows record the exact content acted on (targetType + targetId) and
-- the originating report (reportId, already present). Both columns are nullable
-- bare strings: no FK (audit rows must outlive the target row), and historical
-- actions keep NULL targets — no fuzzy backfill is attempted.

-- AlterTable
ALTER TABLE "ModerationAction" ADD COLUMN     "targetId" TEXT;
ALTER TABLE "ModerationAction" ADD COLUMN     "targetType" TEXT;

-- CreateIndex
CREATE INDEX "ModerationAction_targetType_targetId_idx" ON "ModerationAction"("targetType", "targetId");
