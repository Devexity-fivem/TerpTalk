-- Report reporter lifecycle — a filed report must outlive the reporter's
-- account so case history and ModerationAction.reportId never dangle.
-- Mirrors the Feedback.author SetNull precedent: the signal survives the
-- account; reporter identity is erased with it. Non-destructive: drops and
-- re-adds the FK with SET NULL and drops NOT NULL. Existing rows keep their
-- reporterId values unchanged.

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_reporterId_fkey";

-- AlterTable
ALTER TABLE "Report" ALTER COLUMN "reporterId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
