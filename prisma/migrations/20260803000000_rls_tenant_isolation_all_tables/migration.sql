-- =====================================================================
-- Row Level Security — extend tenant isolation to ALL tables
-- =====================================================================
--
-- This migration supersedes the unversioned scripts in
--   prisma/migrations/tenant_isolation.sql
--   prisma/migrations/rls_super_admin.sql
-- which only covered 13 hardcoded tables. This one is data-driven:
-- it queries information_schema and applies the policy to every table
-- that has a `tenant_id` column.
--
-- Policy shape (matches the existing team's choice — do not change
-- without coordinating):
--
--   USING (
--     tenant_id IS NULL                          -- legacy rows
--     OR current_setting('app.tenant_id', true) = '*'   -- super-admin
--     OR tenant_id::text = current_setting('app.tenant_id', true)  -- scoped
--   )
--
-- The `'*'` wildcard is what makes withSuperAdminRls() in
-- src/lib/rls.ts work. Setting app.tenant_id to '*' bypasses the
-- tenant filter for that transaction.
--
-- The `tenant_id IS NULL` branch keeps legacy data visible — if your
-- pre-RLS data has any rows with NULL tenant_id, removing this clause
-- will hide them. Audit before tightening.
--
-- Idempotency: every step is a DO block guarded by IF (to_regclass
-- IS NOT NULL) or IF NOT EXISTS. Re-running this migration is safe
-- and produces the same end state.
--
-- =====================================================================

-- ── 1. Indexes on tenant_id for every table that has the column ─────────────
-- Critical: the policy's USING clause does a per-row comparison. Without
-- an index on tenant_id, every SELECT becomes a full table scan. The
-- WHERE-tenantId query patterns the team already uses would still hit
-- the index, but RLS would force a full scan for the policy check.
-- Adding the index makes the policy check index-backed.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tbl
      ON tbl.table_schema = c.table_schema
     AND tbl.table_name   = c.table_name
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
      AND tbl.table_type  = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%I_tenant_id ON %I.%I(tenant_id)',
      t.table_name, t.table_schema, t.table_name
    );
  END LOOP;
END
$$;

-- ── 2. Enable RLS on every tenant-scoped table ───────────────────────────────
-- ENABLE ROW LEVEL SECURITY turns the policy on. FORCE ROW LEVEL SECURITY
-- makes it apply even to the table owner (matters for the migration
-- role running tests; the production app role is always subject).
--
-- We FORCE because:
--   - The test suite uses the table owner role to seed cross-tenant
--     data. Without FORCE, those tests would silently bypass RLS and
--     give false positives. With FORCE, the test author must
--     explicitly call withSuperAdminRls() to set the '*' wildcard.
--   - In production, the app connects as a non-owner role (the
--     fleet360_app role from
--     prisma/migrations/20260802210000_create_canary_role/), so
--     FORCE is redundant but harmless.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tbl
      ON tbl.table_schema = c.table_schema
     AND tbl.table_name   = c.table_name
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
      AND tbl.table_type  = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.table_schema, t.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE  ROW LEVEL SECURITY', t.table_schema, t.table_name);
  END LOOP;
END
$$;

-- ── 3. Create or replace the tenant_isolation policy ─────────────────────────
-- Drop-then-create makes this idempotent: the new policy always wins,
-- and re-running picks up any drift in the policy body.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tbl
      ON tbl.table_schema = c.table_schema
     AND tbl.table_name   = c.table_name
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
      AND tbl.table_type  = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', t.table_schema, t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I '
      || 'USING ('
      ||   'tenant_id IS NULL '
      ||   'OR current_setting(''app.tenant_id'', true) = ''*'' '
      ||   'OR tenant_id::text = current_setting(''app.tenant_id'', true)'
      || ')',
      t.table_schema, t.table_name
    );
  END LOOP;
END
$$;

-- ── 4. Helper function for explicit context set ──────────────────────────────
-- Pairs with src/lib/rls.ts setRlsContext(). Most call sites should
-- prefer the with* helpers (which wrap in a transaction). This function
-- is for the long-running cron / out-of-transaction case.

CREATE OR REPLACE FUNCTION set_tenant_context(tid TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.tenant_id', tid, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 5. Sanity check (run by hand, do not commit output) ──────────────────────
--
-- Verify the policy is in place on every expected table:
--
--   SELECT schemaname, tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--   AND rowsecurity = true
--   ORDER BY tablename;
--
-- Count policies by name (should equal count of tables with tenant_id):
--
--   SELECT polname, COUNT(*) AS n
--   FROM pg_policy
--   WHERE polname = 'tenant_isolation'
--   GROUP BY polname;
--
-- Prove the '*' wildcard works:
--
--   SET app.tenant_id = '*';
--   SELECT COUNT(*) FROM vehicles;   -- should match all rows
--
--   SET app.tenant_id = '<some-real-tenant-uuid>';
--   SELECT COUNT(*) FROM vehicles;   -- should match just that tenant
--
--   SET app.tenant_id = '';
--   SELECT COUNT(*) FROM vehicles;   -- should match only tenant_id IS NULL rows
--
-- Prove owner subjection (because we used FORCE):
--
--   \dt vehicles   -- confirm rls is enabled
--   SET ROLE <table_owner>;
--   SELECT COUNT(*) FROM vehicles;   -- should still be RLS-filtered
