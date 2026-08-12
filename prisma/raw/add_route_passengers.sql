-- route_passengers — standing passenger roster on a Route.
--
-- Passengers register on a ROUTE, not on individual trips. When a trip is
-- scheduled from a route, this roster expands into TripPassenger rows for
-- that specific trip (that materialisation is phase 2 — this table is the
-- first-class source of truth for who normally rides which route).
--
-- Applied out-of-band because the shared dev DB has lease_* drift blocking
-- `prisma db push` / `migrate dev`. Promote to a real migration once the
-- lease drift is reconciled.
CREATE TABLE IF NOT EXISTS route_passengers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  tenant_id         TEXT        NOT NULL,
  route_id          UUID        NOT NULL,
  staff_member_id   UUID        NOT NULL,
  pickup_stop_id    UUID,
  pickup_time       TEXT,       -- 'HH:MM' 24h — nullable if not scheduled yet
  dropoff_stop_id   UUID,
  dropoff_time      TEXT,
  effective_from    DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to      DATE,       -- NULL = open-ended
  status            TEXT        NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | INACTIVE
  notes             TEXT,
  created_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_route_passengers_tenant  ON route_passengers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_route_passengers_route   ON route_passengers (route_id);
CREATE INDEX IF NOT EXISTS idx_route_passengers_staff   ON route_passengers (staff_member_id);
CREATE INDEX IF NOT EXISTS idx_route_passengers_deleted ON route_passengers (deleted_at);
CREATE INDEX IF NOT EXISTS idx_route_passengers_status  ON route_passengers (status);
