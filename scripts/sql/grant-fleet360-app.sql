-- Grants for fleet360_app — the application role that does NOT bypass RLS.
--
-- Run as neondb_owner. Idempotent: safe to re-run, grants only, no revokes,
-- no DDL against application tables.
--
--   psql "$DIRECT_URL" -f scripts/sql/grant-fleet360-app.sql
-- or
--   npx prisma db execute --file scripts/sql/grant-fleet360-app.sql --schema prisma/schema.prisma
--
-- WHY
-- The application currently connects as neondb_owner, which has
-- rolbypassrls = true. That overrides even FORCE ROW LEVEL SECURITY, so all
-- 256 RLS-enabled tables are currently unprotected at the database level and
-- tenant isolation rests entirely on application-level tenantId filtering.
--
-- fleet360_app already exists with rolbypassrls = false, but is missing the
-- grants it needs, so the connection string still points at neondb_owner.
-- This closes that gap. See docs/RLS_ENFORCEMENT_ROLE_PLAN.md.
--
-- CURRENT GAPS THIS FIXES (measured, not assumed)
--   USAGE on finance/ai/workforce/fleet/operations/spatial  : missing (all six)
--   table DML                                                : 332 of 364 tables
--   CREATE on public                                         : missing
--   default privileges for future tables outside public      : missing

DO $$
DECLARE
  s TEXT;
  schemas TEXT[] := ARRAY['public','finance','ai','workforce','fleet','operations','spatial'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    RAISE EXCEPTION 'role fleet360_app does not exist — create it first';
  END IF;

  -- Belt and braces: this whole exercise is pointless if the role can bypass.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'fleet360_app has BYPASSRLS — RLS would not be enforced. Run: ALTER ROLE fleet360_app NOBYPASSRLS;';
  END IF;

  FOREACH s IN ARRAY schemas LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
      RAISE NOTICE 'skip schema %: not present', s;
      CONTINUE;
    END IF;

    EXECUTE format('GRANT USAGE ON SCHEMA %I TO fleet360_app', s);

    -- CREATE is granted deliberately. ~95 source files still perform runtime
    -- DDL (ensureAuditTable, ensureFleetSchema, ensureBrandingColumns, ...),
    -- and those calls fail without it. Revoke this once
    -- docs/RETIRE_RUNTIME_DDL_PLAN.md is delivered — it is the one privilege
    -- here that should not be permanent.
    EXECUTE format('GRANT CREATE ON SCHEMA %I TO fleet360_app', s);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO fleet360_app', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO fleet360_app', s);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO fleet360_app', s);

    -- Future objects created by neondb_owner (i.e. by migrations).
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA %I
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fleet360_app', s);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA %I
         GRANT USAGE, SELECT ON SEQUENCES TO fleet360_app', s);

    RAISE NOTICE 'granted on schema %', s;
  END LOOP;
END $$;

-- Verification — expect USAGE/CREATE true for every schema, and the table
-- count to match the total.
SELECT n.nspname                                              AS schema,
       has_schema_privilege('fleet360_app', n.nspname, 'USAGE')  AS usage,
       has_schema_privilege('fleet360_app', n.nspname, 'CREATE') AS create_,
       count(c.oid) FILTER (WHERE c.relkind = 'r')            AS tables,
       count(c.oid) FILTER (WHERE c.relkind = 'r'
              AND has_table_privilege('fleet360_app', c.oid, 'SELECT')) AS readable
  FROM pg_namespace n
  LEFT JOIN pg_class c ON c.relnamespace = n.oid
 WHERE n.nspname IN ('public','finance','ai','workforce','fleet','operations','spatial')
 GROUP BY n.nspname
 ORDER BY n.nspname;
