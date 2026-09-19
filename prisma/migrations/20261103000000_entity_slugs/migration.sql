-- Add nullable slug columns. NULLs are distinct under a unique index, so
-- rows may briefly lack a slug (deploy window / old-code inserts) without
-- breaking uniqueness. Backfilled below.
ALTER TABLE "GrowDiary" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "GrowSetup" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "Strain" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- Backfill: slugify(title) || '-' || right(id, 6) — the same algorithm the
-- app uses for new rows (lower → [^a-z0-9]+ → '-' → trim edges → 60-char
-- cap → trim edges again), with a per-entity fallback when a title is all
-- punctuation/emoji. right(id, 6) is cuid entropy; the row_number() guard
-- keeps the unique index reachable even in the pathological same-base +
-- same-suffix case. Soft-deleted rows are backfilled too — the unique
-- index covers them.
UPDATE "GrowDiary" t SET "slug" = s.slug
FROM (
  SELECT id, cand || CASE WHEN rn > 1 THEN '-' || rn ELSE '' END AS slug
  FROM (
    SELECT id,
           COALESCE(NULLIF(trim(both '-' from left(trim(both '-' from regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g')), 60)), ''), 'diary')
             || '-' || lower(right("id", 6)) AS cand,
           row_number() OVER (
             PARTITION BY COALESCE(NULLIF(trim(both '-' from left(trim(both '-' from regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g')), 60)), ''), 'diary')
               || '-' || lower(right("id", 6))
             ORDER BY "createdAt", "id"
           ) AS rn
    FROM "GrowDiary"
    WHERE "slug" IS NULL
  ) x
) s
WHERE t."id" = s."id";

UPDATE "GrowSetup" t SET "slug" = s.slug
FROM (
  SELECT id, cand || CASE WHEN rn > 1 THEN '-' || rn ELSE '' END AS slug
  FROM (
    SELECT id,
           COALESCE(NULLIF(trim(both '-' from left(trim(both '-' from regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g')), 60)), ''), 'setup')
             || '-' || lower(right("id", 6)) AS cand,
           row_number() OVER (
             PARTITION BY COALESCE(NULLIF(trim(both '-' from left(trim(both '-' from regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g')), 60)), ''), 'setup')
               || '-' || lower(right("id", 6))
             ORDER BY "createdAt", "id"
           ) AS rn
    FROM "GrowSetup"
    WHERE "slug" IS NULL
  ) x
) s
WHERE t."id" = s."id";

UPDATE "Strain" t SET "slug" = s.slug
FROM (
  SELECT id, cand || CASE WHEN rn > 1 THEN '-' || rn ELSE '' END AS slug
  FROM (
    SELECT id,
           COALESCE(NULLIF(trim(both '-' from left(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), 60)), ''), 'strain')
             || '-' || lower(right("id", 6)) AS cand,
           row_number() OVER (
             PARTITION BY COALESCE(NULLIF(trim(both '-' from left(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), 60)), ''), 'strain')
               || '-' || lower(right("id", 6))
             ORDER BY "createdAt", "id"
           ) AS rn
    FROM "Strain"
    WHERE "slug" IS NULL
  ) x
) s
WHERE t."id" = s."id";

CREATE UNIQUE INDEX "GrowDiary_slug_key" ON "GrowDiary"("slug");
CREATE UNIQUE INDEX "GrowSetup_slug_key" ON "GrowSetup"("slug");
CREATE UNIQUE INDEX "Strain_slug_key" ON "Strain"("slug");
