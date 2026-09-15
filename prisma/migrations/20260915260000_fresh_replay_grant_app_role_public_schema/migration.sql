-- Closes a third fresh-replay gap found while verifying issue #77 end-to-end:
-- fleet360_app — the actual runtime role the application connects as
-- (confirmed via RUNTIME_DIRECT_DATABASE_URL) — has zero privileges on
-- public-schema tables on a fresh replay, even after every other fix in
-- this series. On a truly fresh database the application itself would be
-- completely non-functional: `permission denied for table X` on nearly
-- every query, not an RLS denial (RLS only evaluates once the base
-- privilege check already passed).
--
-- 20260910000010_grant_app_role_schema_access's own comment already states
-- the situation plainly: "fleet360_app is fully granted on `public` — 331
-- tables, 42 functions, and default privileges for future tables" — and
-- that migration deliberately does NOT re-grant on public's EXISTING
-- tables, only adding the two DEFAULT PRIVILEGE types (sequences,
-- functions) public was missing; it explicitly says "public already has
-- the TABLES default" for future tables. ALTER DEFAULT PRIVILEGES only ever
-- covers objects created by the role that ran it, AFTER it ran — it cannot
-- retroactively grant on tables that already existed, and confers nothing
-- at all on a fresh replay where the broad EXISTING-tables grant this
-- comment refers to was never captured as a tracked migration in the first
-- place. Same untracked-legacy-path pattern as every other gap in this
-- series, just for base object privileges instead of RLS/columns/tables —
-- confirmed via has_table_privilege() directly against a fresh replay
-- (false for fleet360_app on both audit_logs and bookings, tables from
-- opposite ends of this repository's history) before writing this.
--
-- Fix: the same broad grant 20260910000010 already gives the other six
-- schemas, extended to public's existing tables. Dated after every other
-- migration in this series so it covers whatever exists in public by the
-- end of a full replay, regardless of exactly when each table was created
-- relative to any single migration. Safe no-op on every real environment,
-- where fleet360_app already has this access.
--
-- No manual resolve step needed — this doesn't replace a broken migration,
-- it adds a grant no tracked migration ever made.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fleet360_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fleet360_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO fleet360_app;

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND NOT (has_table_privilege('fleet360_app', c.oid, 'SELECT')
          AND has_table_privilege('fleet360_app', c.oid, 'INSERT')
          AND has_table_privilege('fleet360_app', c.oid, 'UPDATE')
          AND has_table_privilege('fleet360_app', c.oid, 'DELETE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'verification failed: fleet360_app lacks full DML on public.%', bad;
  END IF;
END $$;
