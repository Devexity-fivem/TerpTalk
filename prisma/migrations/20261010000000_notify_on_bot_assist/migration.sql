-- Opt-out preference for TerpBot's event-driven assist notifications
-- (BOT_ASSIST type). Default true = existing members keep receiving assists;
-- turning it off is a pure preference toggle.
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "notifyOnBotAssist" BOOLEAN NOT NULL DEFAULT true;
