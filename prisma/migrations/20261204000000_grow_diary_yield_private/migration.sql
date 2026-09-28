-- Profile V2 P3: per-harvest yield privacy flag (locked plan §6/§20).
-- Member-set; exact yield hidden from non-owner viewers when true.
ALTER TABLE "GrowDiary" ADD COLUMN "yieldPrivate" BOOLEAN NOT NULL DEFAULT false;
