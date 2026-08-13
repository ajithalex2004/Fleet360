-- bus_ops_schedule_templates — recurring schedule rules for staff transport.
--
-- A template describes "this trip runs every {activeDays} at {departureTime}
-- from {effectiveFrom} to {effectiveTo}". A generator materialises this into
-- concrete TripSchedule rows for a specific date window.
--
-- Also adds:
--   - bus_routes.code : tenant-scoped short route code (Route Code column)
--   - trip_schedules.template_id : back-reference so dispatch can show the
--     source template and instances can be regenerated when a template changes
--
-- Applied via raw SQL because the shared dev DB has lease_* drift blocking
-- `prisma db push` / `migrate dev`. Promote to a real migration once the
-- lease drift is reconciled.

CREATE TABLE IF NOT EXISTS bus_ops_schedule_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  tenant_id       TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  route_id        UUID        NOT NULL,
  vehicle_id      TEXT,                    -- default vehicle for instances (nullable — assign per trip)
  driver_id       TEXT,                    -- default driver for instances
  week_type       TEXT        NOT NULL,    -- SUN_THU | MON_FRI | SAT_WED | CUSTOM
  active_days     INT[]       NOT NULL DEFAULT '{}',   -- 0=Sun … 6=Sat
  session         TEXT        NOT NULL,    -- MORNING | EVENING | NIGHT | SPLIT
  departure_time  TEXT        NOT NULL,    -- 'HH:MM' 24h
  arrival_time    TEXT,                    -- 'HH:MM' 24h — auto-fill from route.duration
  direction       TEXT        NOT NULL,    -- PICKUP | DROPOFF
  effective_from  DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,                    -- NULL = open-ended
  exception_dates DATE[]      NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | INACTIVE
  notes           TEXT,
  created_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_bus_ops_schedule_templates_tenant   ON bus_ops_schedule_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_ops_schedule_templates_route    ON bus_ops_schedule_templates (route_id);
CREATE INDEX IF NOT EXISTS idx_bus_ops_schedule_templates_deleted  ON bus_ops_schedule_templates (deleted_at);
CREATE INDEX IF NOT EXISTS idx_bus_ops_schedule_templates_status   ON bus_ops_schedule_templates (status);

-- BusRoute short code — tenant-scoped unique when non-null.
ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bus_routes_tenant_code
  ON bus_routes (tenant_id, code) WHERE code IS NOT NULL;

-- Back-reference from a generated TripSchedule to the template that produced it.
ALTER TABLE trip_schedules ADD COLUMN IF NOT EXISTS template_id UUID;
CREATE INDEX IF NOT EXISTS idx_trip_schedules_template ON trip_schedules (template_id);
