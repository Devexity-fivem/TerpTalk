-- AlterTable
ALTER TABLE "Strain" ADD COLUMN     "createdById" TEXT;

-- CreateTable
CREATE TABLE "StrainPhoto" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT,
    "strainId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrainPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrainPhoto_strainId_idx" ON "StrainPhoto"("strainId");

-- CreateIndex
CREATE INDEX "StrainPhoto_userId_idx" ON "StrainPhoto"("userId");

-- AddForeignKey
ALTER TABLE "Strain" ADD CONSTRAINT "Strain_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrainPhoto" ADD CONSTRAINT "StrainPhoto_strainId_fkey" FOREIGN KEY ("strainId") REFERENCES "Strain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrainPhoto" ADD CONSTRAINT "StrainPhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
