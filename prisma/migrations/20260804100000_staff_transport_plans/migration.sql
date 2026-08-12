-- =====================================================================
-- staff_transport_plans — planning core (run/block/roster) storage
-- =====================================================================
--
-- Each row is one planning scenario. The runs/blocks/rosters are
-- stored as JSONB so the algorithm module can evolve without migrations.
-- When a plan is "applied", the run→driver and block→vehicle mappings
-- are written back to trip_schedules via the /api/bus-ops/plan/[id]/apply
-- endpoint.
--
-- RLS: tenantId is set by the planner. Super-admin reads bypass RLS
-- through withPlatformAdmin (the planner only exposes same-tenant plans
-- to tenant admins).
--
-- Indexed for the two common queries:
--   - "list plans for this tenant in this date range"
--   - "list my draft plans"
-- =====================================================================

CREATE TABLE IF NOT EXISTS staff_transport_plans (
  id                TEXT PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id         TEXT,

  name              TEXT NOT NULL,
  description       TEXT,

  date_from         DATE NOT NULL,
  date_to           DATE NOT NULL,

  work_rules        JSONB NOT NULL,
  block_options     JSONB NOT NULL,

  runs              JSONB NOT NULL,
  blocks            JSONB NOT NULL,
  rosters           JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary           JSONB NOT NULL,

  status            TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT|APPLIED|ARCHIVED
  applied_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_plans_tenant_window
  ON staff_transport_plans (tenant_id, date_from, date_to);

CREATE INDEX IF NOT EXISTS idx_plans_tenant_status
  ON staff_transport_plans (tenant_id, status);

-- RLS policy: tenant admins can only see plans for their tenant.
-- We follow the same pattern as the rest of the bus-ops tables.
ALTER TABLE staff_transport_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_transport_plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_tenant_isolation ON staff_transport_plans;
CREATE POLICY plans_tenant_isolation ON staff_transport_plans
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
