-- Migration: 20260623150000_add_vehicle_locations
-- Reconstructed 2026-08-10 from live production schema.
-- Original file was lost; tables already exist in production.
-- Registered via: npx prisma migrate resolve --applied 20260623150000_add_vehicle_locations

CREATE TABLE IF NOT EXISTS vehicle_locations (
  id          TEXT        PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id   TEXT        NOT NULL,
  vehicle_id  TEXT        NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  latitude    FLOAT8      NOT NULL,
  longitude   FLOAT8      NOT NULL,
  speed_kph   FLOAT8,
  heading_deg FLOAT8,
  odometer    INTEGER,
  source      TEXT,

  CONSTRAINT fk_vehicle_locations_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_vehicle_locations_vehicle
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_locations_tenant_id
  ON vehicle_locations(tenant_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_locations_vehicle_recorded
  ON vehicle_locations(vehicle_id, recorded_at DESC);
