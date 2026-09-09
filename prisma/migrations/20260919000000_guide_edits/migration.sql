-- Guide edit history for collaborative wiki-style grow guides
CREATE TABLE "GuideEdit" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuideEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GuideEdit_guideId_idx" ON "GuideEdit"("guideId");
CREATE INDEX "GuideEdit_editorId_idx" ON "GuideEdit"("editorId");

ALTER TABLE "GuideEdit" ADD CONSTRAINT "GuideEdit_guideId_fkey"
  FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuideEdit" ADD CONSTRAINT "GuideEdit_editorId_fkey"
  FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
