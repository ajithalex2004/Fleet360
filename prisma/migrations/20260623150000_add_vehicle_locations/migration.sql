-- Phase B — live vehicle location.
--
-- Two changes:
--   1. Five denormalized "latest position" columns on `vehicles` so a
--      fleet-map query can read every vehicle's current state in one
--      row without joining the time-series.
--   2. A new `vehicle_locations` time-series ledger that holds every
--      position reading we receive. The vehicles.current_* columns are
--      a view of the most recent row here per vehicle, kept fresh by
--      the IngestVehicleLocation handler.
--
-- No backfill — Vehicle.current_* defaults to NULL until a reading
-- arrives. Existing rows are forward-compatible: reads return NULL,
-- updates leave them alone.

-- ── vehicles.current_* columns ─────────────────────────────────────────
ALTER TABLE "vehicles" ADD COLUMN "current_lat" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN "current_lng" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN "current_speed_kph" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN "current_heading_deg" DOUBLE PRECISION;
ALTER TABLE "vehicles" ADD COLUMN "current_location_at" TIMESTAMPTZ(6);

-- ── vehicle_locations time-series ──────────────────────────────────────
CREATE TABLE "vehicle_locations" (
  "id"           TEXT PRIMARY KEY,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "tenant_id"    TEXT NOT NULL,
  "vehicle_id"   TEXT NOT NULL,
  "recorded_at"  TIMESTAMPTZ(6) NOT NULL,
  "latitude"     DOUBLE PRECISION NOT NULL,
  "longitude"    DOUBLE PRECISION NOT NULL,
  "speed_kph"    DOUBLE PRECISION,
  "heading_deg"  DOUBLE PRECISION,
  "odometer"     INTEGER,
  "source"       TEXT,

  CONSTRAINT "fk_vehicle_locations_vehicle"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_vehicle_locations_tenant"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT
);

-- Hot query: "latest position for vehicle X" or "trail for vehicle X
-- between T1 and T2" — both sort by recorded_at DESC after filtering
-- by vehicle_id. Composite index in that exact shape.
CREATE INDEX "idx_vehicle_locations_vehicle_recorded"
  ON "vehicle_locations"("vehicle_id", "recorded_at" DESC);

-- Tenant-scope index for the WithTenant GORM scope filter.
CREATE INDEX "idx_vehicle_locations_tenant_id"
  ON "vehicle_locations"("tenant_id");
