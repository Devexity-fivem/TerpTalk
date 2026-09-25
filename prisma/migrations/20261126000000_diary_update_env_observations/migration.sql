-- Slice A: structured environmental observations on DiaryUpdate.
-- All nullable Float — additive only, no backfill, historical rows stay valid.

ALTER TABLE "DiaryUpdate" ADD COLUMN "nightTemperature" DOUBLE PRECISION;
ALTER TABLE "DiaryUpdate" ADD COLUMN "substrateTemperature" DOUBLE PRECISION;
ALTER TABLE "DiaryUpdate" ADD COLUMN "co2Ppm" DOUBLE PRECISION;
ALTER TABLE "DiaryUpdate" ADD COLUMN "wateringLiters" DOUBLE PRECISION;
ALTER TABLE "DiaryUpdate" ADD COLUMN "ppfd" DOUBLE PRECISION;
ALTER TABLE "DiaryUpdate" ADD COLUMN "photoperiodHours" DOUBLE PRECISION;
ALTER TABLE "DiaryUpdate" ADD COLUMN "runoffPh" DOUBLE PRECISION;
ALTER TABLE "DiaryUpdate" ADD COLUMN "runoffEc" DOUBLE PRECISION;
ALTER TABLE "DiaryUpdate" ADD COLUMN "lampDistanceCm" DOUBLE PRECISION;
