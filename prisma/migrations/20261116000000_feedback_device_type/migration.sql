-- Coarse device class for feedback reports (mobile/tablet/desktop) so
-- "broken on my phone" arrives pre-classified. Derived from the UA header
-- server-side — never trusted from the client, never stores the raw UA.
ALTER TABLE "Feedback" ADD COLUMN "deviceType" TEXT;
