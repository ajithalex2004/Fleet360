-- Migration: 20260812090000_ble_gateway_tenant_isolation
--
-- Adds tenant_id to the three BLE tables that were originally created
-- without it in 20260506000003_add_ble_gateway:
--
--   ble_gateways           -- gateway hardware registered per vehicle
--   staff_ble_tags         -- BLE tags issued to staff members
--   ble_gateway_presence   -- tag presence cache (schema.prisma had it; DB did not)
--
-- Once the columns exist the data-driven RLS blocks from
-- 20260803000000_rls_tenant_isolation_all_tables apply. Rather than
-- re-running those DO loops (which would touch every table again), we
-- apply the same policy pattern explicitly to these three tables.
-- All steps are idempotent — re-running this migration is safe.

-- ── 1. Add tenant_id columns ─────────────────────────────────────────────────

ALTER TABLE ble_gateways         ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE staff_ble_tags       ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE ble_gateway_presence ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- ── 2. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ble_gateways_tenant_id
  ON ble_gateways (tenant_id);

CREATE INDEX IF NOT EXISTS idx_staff_ble_tags_tenant_id
  ON staff_ble_tags (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ble_gateway_presence_tenant_id
  ON ble_gateway_presence (tenant_id);

-- ── 3. Row Level Security ────────────────────────────────────────────────────
-- Policy shape matches 20260803000000 exactly:
--   - NULL tenant_id rows remain visible (legacy / hardware-inserted rows)
--   - app.tenant_id = '*' bypasses (super-admin / migrations)
--   - otherwise tenant_id must match the session's app.tenant_id

ALTER TABLE ble_gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE ble_gateways FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ble_gateways;
CREATE POLICY tenant_isolation ON ble_gateways
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );

ALTER TABLE staff_ble_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_ble_tags FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_ble_tags;
CREATE POLICY tenant_isolation ON staff_ble_tags
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );

ALTER TABLE ble_gateway_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ble_gateway_presence FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ble_gateway_presence;
CREATE POLICY tenant_isolation ON ble_gateway_presence
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );
