-- Migration: 20260623170000_add_fuel_types
-- Reconstructed 2026-08-10 from live production schema.
-- Original file was lost; tables already exist in production.
-- Registered via: npx prisma migrate resolve --applied 20260623170000_add_fuel_types

CREATE TABLE IF NOT EXISTS fuel_types (
  id                TEXT        PRIMARY KEY,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  tenant_id         TEXT        NOT NULL,
  code              TEXT        NOT NULL,
  name              TEXT        NOT NULL,
  category          TEXT,
  density_kg_per_l  NUMERIC,
  cost_per_litre_aed NUMERIC,
  co2_kg_per_l      NUMERIC,
  is_active         BOOLEAN     DEFAULT TRUE,

  CONSTRAINT fk_fuel_types_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_fuel_types_tenant_id
  ON fuel_types(tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_fuel_types_tenant_code
  ON fuel_types(tenant_id, code)
  WHERE deleted_at IS NULL;

-- Add fuel_type_id FK on vehicles (fuel_type TEXT column was added earlier)
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS fuel_type_id TEXT
    REFERENCES fuel_types(id) ON DELETE SET NULL;
