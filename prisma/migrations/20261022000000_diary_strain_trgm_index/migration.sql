-- Trigram index for legacy fuzzy strain matching in strain-stats.
-- pg_trgm extension already exists (20260928000000_add_scalability_indexes).
-- GrowDiary.strain is nullable; GIN trgm handles ILIKE '%...%' lookups.
CREATE INDEX IF NOT EXISTS "GrowDiary_strain_trgm_idx" ON "GrowDiary" USING gin ("strain" gin_trgm_ops);
