-- Privacy: drop unused email columns. TerpTalk registration is
-- username-only by design; these columns were never populated and
-- represented pure data-collection surface.
DROP INDEX IF EXISTS "User_email_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "email";
ALTER TABLE "User" DROP COLUMN IF EXISTS "emailVerified";
