-- Migration: 20260623160000_add_vehicle_group_hierarchy
-- Reconstructed 2026-08-10 from live production schema.
-- Original file was lost; tables already exist in production.
-- Registered via: npx prisma migrate resolve --applied 20260623160000_add_vehicle_group_hierarchy

-- CREATE TYPE IF NOT EXISTS is not valid PostgreSQL syntax; use a DO block instead.
DO $$ BEGIN
  CREATE TYPE "VehicleGroupLevel" AS ENUM ('REGION', 'DEPARTMENT', 'UNIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS vehicle_groups (
  id          TEXT             PRIMARY KEY,
  created_at  TIMESTAMPTZ      DEFAULT NOW(),
  updated_at  TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  tenant_id   TEXT             NOT NULL,
  level       "VehicleGroupLevel" NOT NULL,
  parent_id   TEXT,
  code        TEXT             NOT NULL,
  name        TEXT             NOT NULL,
  description TEXT,
  is_active   BOOLEAN          DEFAULT TRUE,

  CONSTRAINT fk_vehicle_groups_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_vehicle_groups_parent
    FOREIGN KEY (parent_id) REFERENCES vehicle_groups(id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_groups_tenant_id
  ON vehicle_groups(tenant_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_groups_level
  ON vehicle_groups(level);

CREATE INDEX IF NOT EXISTS idx_vehicle_groups_parent_id
  ON vehicle_groups(parent_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_vehicle_groups_tenant_level_code
  ON vehicle_groups(tenant_id, level, code)
  WHERE deleted_at IS NULL;

-- Add group and fuel_type links to vehicles
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS vehicle_group_id TEXT
    REFERENCES vehicle_groups(id) ON DELETE SET NULL;
