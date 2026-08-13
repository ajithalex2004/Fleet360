-- bus_ops_vehicle_positions — one row per vehicle, overwritten on each GPS
-- ping. Powers /bus-ops/live-map (fleet live tracking). Staff-transport
-- variant of school_bus_vehicle_positions: passengers_onboard instead of
-- students_onboard, no attendant column, otherwise the same shape.
--
-- Applied out-of-band because the shared dev DB has drift in lease_*
-- tables that blocks `prisma db push` and `migrate dev`. Promote to a real
-- Prisma migration once the lease drift is reconciled.
CREATE TABLE IF NOT EXISTS bus_ops_vehicle_positions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL,
  vehicle_id        TEXT        NOT NULL,
  vehicle_plate     TEXT,
  route_id          UUID,
  route_name        TEXT,
  trip_id           UUID,
  driver_id         TEXT,
  driver_name       TEXT,
  lat               DOUBLE PRECISION NOT NULL,
  lng               DOUBLE PRECISION NOT NULL,
  speed_kmh         DOUBLE PRECISION NOT NULL DEFAULT 0,
  heading_deg       INT         NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'EN_ROUTE',
                              -- EN_ROUTE | AT_STOP | IDLE | OFFLINE | BREAKDOWN
  next_stop_name    TEXT,
  next_stop_eta     TIMESTAMPTZ,
  passengers_onboard INT        NOT NULL DEFAULT 0,
  last_ping_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bovp_vehicle ON bus_ops_vehicle_positions (vehicle_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_bovp_tenant ON bus_ops_vehicle_positions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bovp_route  ON bus_ops_vehicle_positions (route_id);
