-- AlterTable
ALTER TABLE "Reaction" ADD COLUMN     "momentId" TEXT;

-- CreateTable
CREATE TABLE "Moment" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'POST',
    "content" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "authorId" TEXT NOT NULL,
    "diaryId" TEXT,
    "strainId" TEXT,
    "repostOfId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Moment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MomentImage" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "momentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MomentImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MomentComment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "momentId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MomentComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MomentTag" (
    "momentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "MomentTag_pkey" PRIMARY KEY ("momentId","tagId")
);

-- CreateIndex
CREATE INDEX "Moment_authorId_createdAt_idx" ON "Moment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Moment_kind_createdAt_idx" ON "Moment"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "Moment_createdAt_idx" ON "Moment"("createdAt");

-- CreateIndex
CREATE INDEX "Moment_repostOfId_idx" ON "Moment"("repostOfId");

-- CreateIndex
CREATE INDEX "Moment_diaryId_idx" ON "Moment"("diaryId");

-- CreateIndex
CREATE INDEX "Moment_strainId_idx" ON "Moment"("strainId");

-- CreateIndex
CREATE INDEX "Moment_kind_expiresAt_idx" ON "Moment"("kind", "expiresAt");

-- CreateIndex
CREATE INDEX "MomentImage_momentId_idx" ON "MomentImage"("momentId");

-- CreateIndex
CREATE INDEX "MomentImage_createdAt_idx" ON "MomentImage"("createdAt");

-- CreateIndex
CREATE INDEX "MomentComment_momentId_createdAt_idx" ON "MomentComment"("momentId", "createdAt");

-- CreateIndex
CREATE INDEX "MomentComment_authorId_idx" ON "MomentComment"("authorId");

-- CreateIndex
CREATE INDEX "MomentTag_tagId_idx" ON "MomentTag"("tagId");

-- CreateIndex
CREATE INDEX "Reaction_momentId_idx" ON "Reaction"("momentId");

-- CreateIndex
CREATE UNIQUE INDEX "Reaction_userId_momentId_key" ON "Reaction"("userId", "momentId");

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_diaryId_fkey" FOREIGN KEY ("diaryId") REFERENCES "GrowDiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_strainId_fkey" FOREIGN KEY ("strainId") REFERENCES "Strain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_repostOfId_fkey" FOREIGN KEY ("repostOfId") REFERENCES "Moment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentImage" ADD CONSTRAINT "MomentImage_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentComment" ADD CONSTRAINT "MomentComment_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentComment" ADD CONSTRAINT "MomentComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentTag" ADD CONSTRAINT "MomentTag_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentTag" ADD CONSTRAINT "MomentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

