-- BusOpsGeofence — first-class named zones for bus-ops.
-- Applied out-of-band because the shared dev DB has drift in lease_*
-- tables that blocks `prisma db push` and `migrate dev`. Once those are
-- reconciled, promote this into a real Prisma migration.
CREATE TABLE IF NOT EXISTS bus_ops_geofences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ(6) DEFAULT NOW(),
  updated_at  TIMESTAMPTZ(6),
  deleted_at  TIMESTAMPTZ(6),
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,          -- STOP | GARAGE | ORIGIN_DESTINATION | BASE_CAMP | ACCOMMODATION
  shape       TEXT NOT NULL,          -- CIRCLE | POLYGON
  center_lat  DOUBLE PRECISION,
  center_lng  DOUBLE PRECISION,
  radius_m    INTEGER,
  polygon     JSONB,
  address     TEXT,
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_bus_ops_geofences_tenant_id  ON bus_ops_geofences (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_ops_geofences_deleted_at ON bus_ops_geofences (deleted_at);
CREATE INDEX IF NOT EXISTS idx_bus_ops_geofences_type       ON bus_ops_geofences (type);
