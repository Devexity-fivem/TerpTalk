-- Supabase Data API lockdown.
--
-- Supabase serves the `public` schema over its auto-generated REST
-- (PostgREST) and GraphQL APIs, and its default privileges grant the
-- `anon` / `authenticated` roles full read/write on every table created
-- there. TerpTalk never uses those APIs: every query goes through Prisma
-- as the table-owning role (owner + BYPASSRLS on Supabase). With RLS off,
-- anyone holding the project's anon/publishable key could read or rewrite
-- any table (User, Message, ...) directly, bypassing every app-level check.
--
-- 1. RLS on every public table, with no policies: deny-all for every
--    non-owner role, a no-op for the owning app role.
-- 2. Revoke table/sequence grants from PUBLIC and, on Supabase, from the
--    Data API roles, plus the default privileges that would re-grant them
--    on future tables. Plain Postgres (CI, local) has no anon role, so
--    that block is skipped there.
--
-- New tables: add `ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;` in the
-- same migration; scripts/security-tests.mts enforces it.

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END $$;
