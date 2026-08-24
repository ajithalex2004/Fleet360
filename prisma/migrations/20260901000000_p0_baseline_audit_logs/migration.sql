-- P0 CRITICAL: Baseline migration for audit_logs table
-- This migration captures the existing schema created by src/lib/audit.ts
-- and ensures it exists with proper structure before adding RLS

-- Create audit_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  changes JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  branch_id TEXT,
  branch_name TEXT
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- Backfill tenant_id from users table where NULL
-- This ensures all audit logs are associated with a tenant
DO $$
DECLARE
  default_tenant_id TEXT;
BEGIN
  -- Get the first tenant (or create a system tenant if none exists)
  SELECT id INTO default_tenant_id FROM tenants ORDER BY created_at LIMIT 1;

  IF default_tenant_id IS NULL THEN
    -- Create a system tenant if none exists
    INSERT INTO tenants (id, name, code, is_active)
    VALUES (gen_random_uuid(), 'System', 'SYSTEM', true)
    RETURNING id INTO default_tenant_id;
  END IF;

  -- Backfill NULL tenant_id entries
  UPDATE audit_logs
  SET tenant_id = default_tenant_id
  WHERE tenant_id IS NULL;
END $$;

-- Assert no NULL tenant_id remains
DO $$
DECLARE
  null_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO null_count FROM audit_logs WHERE tenant_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'audit_logs: % rows still have NULL tenant_id', null_count;
  END IF;
END $$;

-- Set tenant_id to NOT NULL
ALTER TABLE audit_logs ALTER COLUMN tenant_id SET NOT NULL;

-- Add comment documenting tenant isolation
COMMENT ON TABLE audit_logs IS 'Audit log entries - tenant-isolated via RLS (see next migration)';
COMMENT ON COLUMN audit_logs.tenant_id IS 'Tenant isolation key - enforced by RLS policy';
