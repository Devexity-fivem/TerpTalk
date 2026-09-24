-- Strain catalog facets — all nullable/default-safe additions.
-- Controlled vocabularies enforced at the API layer (lib/strain-fields.ts);
-- arrays default to empty, numerics stay NULL until a member reports them.
ALTER TABLE "Strain" ADD COLUMN "effects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Strain" ADD COLUMN "flavors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Strain" ADD COLUMN "thcMin" DOUBLE PRECISION;
ALTER TABLE "Strain" ADD COLUMN "thcMax" DOUBLE PRECISION;
ALTER TABLE "Strain" ADD COLUMN "floweringWeeks" INTEGER;
ALTER TABLE "Strain" ADD COLUMN "difficulty" TEXT;
