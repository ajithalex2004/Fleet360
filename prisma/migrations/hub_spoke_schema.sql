-- ============================================================
-- Smart Mobility Platform — Hub-and-Spoke Schema Migration
-- Run this on your PostgreSQL database (port 5433)
-- Command: psql "postgresql://postgres:root@localhost:5433/tripxl" -f hub_spoke_schema.sql
-- ============================================================

-- ── 1. Vehicle — add hub core fields ──────────────────────────────────────────
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS color               VARCHAR,
  ADD COLUMN IF NOT EXISTS fuel_type           VARCHAR,
  ADD COLUMN IF NOT EXISTS vehicle_usage       VARCHAR,
  ADD COLUMN IF NOT EXISTS vehicle_group       VARCHAR,
  ADD COLUMN IF NOT EXISTS vehicle_class       VARCHAR,
  ADD COLUMN IF NOT EXISTS seating_capacity    INTEGER,
  ADD COLUMN IF NOT EXISTS fuel_level          FLOAT,
  ADD COLUMN IF NOT EXISTS mulkiya_expiry      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_driver_id  UUID,
  ADD COLUMN IF NOT EXISTS garage_id           UUID;

CREATE INDEX IF NOT EXISTS idx_vehicles_usage  ON vehicles (vehicle_usage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles (status)        WHERE deleted_at IS NULL;

-- ── 2. Driver — add hub compliance fields ─────────────────────────────────────
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS license_type        VARCHAR,
  ADD COLUMN IF NOT EXISTS emirates_id_expiry  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS passport_number     VARCHAR,
  ADD COLUMN IF NOT EXISTS passport_expiry     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS visa_expiry         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status              VARCHAR DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS garage_id           UUID;

CREATE INDEX IF NOT EXISTS idx_drivers_status  ON drivers (status)  WHERE deleted_at IS NULL;

-- ── 3. User — add Admin Hub fields ────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN  DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS module_access  JSONB,
  ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMPTZ;

-- Back-fill: all existing users are active
UPDATE users SET is_active = TRUE WHERE is_active IS NULL;

-- ── 4. UserTenant — add FK to users if missing ────────────────────────────────
-- (UserTenant references users.id — verify the constraint exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'user_tenants'
      AND constraint_name = 'user_tenants_user_id_fkey'
  ) THEN
    ALTER TABLE user_tenants
      ADD CONSTRAINT user_tenants_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id);
  END IF;
END $$;

-- ── Done ──────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE 'Hub-and-Spoke schema migration complete.'; END $$;
