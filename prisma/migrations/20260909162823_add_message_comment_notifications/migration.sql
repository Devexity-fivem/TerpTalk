-- DropIndex
DROP INDEX "Thread_replyCount_idx";

-- AlterTable
ALTER TABLE "AffiliatePartner" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AffiliateProduct" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Guide" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "notifyOnComment" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyOnMessage" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Setting" ALTER COLUMN "updatedAt" DROP DEFAULT;
