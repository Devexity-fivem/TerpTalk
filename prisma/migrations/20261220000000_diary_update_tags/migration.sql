-- AlterTable
ALTER TABLE "DiaryUpdate" ADD COLUMN     "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "issues" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "plantHealth" TEXT,
ADD COLUMN     "trichomeState" TEXT,
ADD COLUMN     "aromaIntensity" INTEGER;

-- AlterTable
ALTER TABLE "GrowDiary" ADD COLUMN     "plantCount" INTEGER;
