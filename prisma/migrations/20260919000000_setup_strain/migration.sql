-- Add optional strain field to GrowSetup so setups can be linked to strain pages
ALTER TABLE "GrowSetup" ADD COLUMN "strain" TEXT;

CREATE INDEX "GrowSetup_strain_idx" ON "GrowSetup"("strain");
