-- Trigram indexes for the columns the Phase 5 search buckets match on.
-- pg_trgm extension already exists (see 20260928000000_add_scalability_indexes).
CREATE INDEX IF NOT EXISTS "Strain_name_trgm_idx" ON "Strain" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GrowDiary_title_trgm_idx" ON "GrowDiary" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GrowDiary_strain_trgm_idx" ON "GrowDiary" USING gin ("strain" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GrowSetup_title_trgm_idx" ON "GrowSetup" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "GrowSetup_strain_trgm_idx" ON "GrowSetup" USING gin ("strain" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DiaryUpdate_content_trgm_idx" ON "DiaryUpdate" USING gin ("content" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Profile_username_trgm_idx" ON "Profile" USING gin ("username" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Tag_name_trgm_idx" ON "Tag" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Guide_title_trgm_idx" ON "Guide" USING gin ("title" gin_trgm_ops);
