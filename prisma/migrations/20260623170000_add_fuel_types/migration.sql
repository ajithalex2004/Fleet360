-- Fuel-type normalization — replaces vehicles.fuel_type free-form
-- string with a typed FK to a reference table that carries the
-- physics each fuel needs (density, cost-per-litre, CO2-per-litre).
-- The legacy string column stays put for backward compatibility;
-- new code reads fuel_type_id.
--
-- Tenant scope: rows are per-tenant because fuel cost varies per
-- operator (corporate discount, subsidy, regional market). The
-- (tenant_id, code) tuple is unique among non-deleted rows so a tenant
-- can recreate a soft-deleted "DIESEL" entry under a new id.

CREATE TABLE "fuel_types" (
  "id"                  TEXT PRIMARY KEY,
  "created_at"          TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ(6),
  "deleted_at"          TIMESTAMPTZ(6),
  "tenant_id"           TEXT NOT NULL,

  "code"                TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "category"            TEXT,
  "density_kg_per_l"    DECIMAL(10, 4),
  "cost_per_litre_aed"  DECIMAL(10, 4),
  "co2_kg_per_l"        DECIMAL(10, 4),
  "is_active"           BOOLEAN DEFAULT TRUE,

  CONSTRAINT "fk_fuel_types_tenant"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT
);

CREATE INDEX "idx_fuel_types_tenant_id" ON "fuel_types"("tenant_id");

-- Tenant + code unique among live rows only.
CREATE UNIQUE INDEX "uniq_fuel_types_tenant_code"
  ON "fuel_types"("tenant_id", "code")
  WHERE "deleted_at" IS NULL;

-- ── vehicles.fuel_type_id ──────────────────────────────────────────────
-- Nullable: existing rows stay un-linked until an operator picks a
-- fuel type. ON DELETE SET NULL so removing a fuel-type row doesn't
-- cascade-delete vehicles (a deleted fuel just means "now unknown",
-- which the rest of the system already handles via the nullable
-- column).
ALTER TABLE "vehicles" ADD COLUMN "fuel_type_id" TEXT;
ALTER TABLE "vehicles" ADD CONSTRAINT "fk_vehicles_fuel_type"
  FOREIGN KEY ("fuel_type_id") REFERENCES "fuel_types"("id")
  ON DELETE SET NULL;
CREATE INDEX "idx_vehicles_fuel_type_id" ON "vehicles"("fuel_type_id");
