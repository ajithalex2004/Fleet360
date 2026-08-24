-- P0 CRITICAL: Add RLS policies to audit_logs
-- This migration enables Row Level Security on audit_logs to prevent
-- cross-tenant data access. Audit logs are immutable (INSERT-only).

-- Enable Row Level Security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owner
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS tenant_isolation ON audit_logs;
DROP POLICY IF EXISTS audit_insert_only ON audit_logs;

-- Policy 1: Tenant Isolation (SELECT)
-- Super admin (tenant_id = '*') can see all audit logs
-- Normal users can only see their tenant's audit logs
CREATE POLICY tenant_isolation ON audit_logs
  FOR SELECT
  USING (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- Policy 2: Insert Only (INSERT)
-- Any authenticated user can insert audit logs for their tenant
-- This prevents modifications after insertion (immutability)
CREATE POLICY audit_insert_only ON audit_logs
  FOR INSERT
  WITH CHECK (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- Policy 3: No Updates Allowed
-- Audit logs should be immutable - no one can update them
CREATE POLICY audit_no_updates ON audit_logs
  FOR UPDATE
  USING (false);

-- Policy 4: No Deletes Allowed
-- Audit logs should be immutable - no one can delete them
CREATE POLICY audit_no_deletes ON audit_logs
  FOR DELETE
  USING (false);

-- Add table comment documenting policies
COMMENT ON TABLE audit_logs IS 'Audit log entries - tenant-isolated via RLS. Immutable: INSERT-only, no UPDATE/DELETE allowed.';

-- Verify RLS is enabled
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'audit_logs') THEN
    RAISE EXCEPTION 'RLS not enabled on audit_logs';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'audit_logs') THEN
    RAISE EXCEPTION 'FORCE RLS not enabled on audit_logs';
  END IF;
END $$;
