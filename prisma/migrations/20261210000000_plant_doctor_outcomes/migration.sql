-- Plant Doctor outcome loop — durable, owner-scoped diagnosis cases plus
-- append-only grower-reported outcomes. Additive only: no existing table
-- or data is touched. Owner data is erased with the account (Cascade);
-- diary/strain links detach (SetNull) so deleted grows can't dangle.

-- CreateTable
CREATE TABLE "PlantDoctorCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "tagSlug" TEXT,
    "diaryId" TEXT,
    "strainId" TEXT,
    "stage" TEXT,
    "mediumType" TEXT,
    "lightType" TEXT,
    "growType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantDoctorCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantDoctorOutcome" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlantDoctorOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlantDoctorCase_userId_createdAt_idx" ON "PlantDoctorCase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PlantDoctorCase_diaryId_idx" ON "PlantDoctorCase"("diaryId");

-- CreateIndex
CREATE INDEX "PlantDoctorOutcome_caseId_createdAt_idx" ON "PlantDoctorOutcome"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlantDoctorCase" ADD CONSTRAINT "PlantDoctorCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantDoctorCase" ADD CONSTRAINT "PlantDoctorCase_diaryId_fkey" FOREIGN KEY ("diaryId") REFERENCES "GrowDiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantDoctorCase" ADD CONSTRAINT "PlantDoctorCase_strainId_fkey" FOREIGN KEY ("strainId") REFERENCES "Strain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantDoctorOutcome" ADD CONSTRAINT "PlantDoctorOutcome_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "PlantDoctorCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
