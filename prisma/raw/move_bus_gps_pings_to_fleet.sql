-- Task 5 — move bus_gps_pings into the fleet domain schema.
--
-- Two paths handled:
--   1. If the table already exists in public: ALTER TABLE ... SET SCHEMA fleet
--      (single atomic move — indexes and constraints follow the table).
--   2. If it doesn't exist yet (this env — no GPS pings ingested yet, table
--      was to be created lazily by ensureBusGpsTables()): CREATE it directly
--      in fleet. The lazy-create helper (src/lib/bus-gps.ts) is updated in
--      the same commit to target fleet.bus_gps_pings so future first-time
--      ingest lands in the right schema.
--
-- Consumers updated in the same commit:
--   - src/lib/bus-gps.ts — DDL helper now targets fleet.bus_gps_pings
--   - src/app/api/bus-ops/vehicles/[id]/location/route.ts — raw INSERT
--   - src/app/api/bus-ops/schedules/[id]/eta/route.ts — raw SELECT
--
-- Prisma:
--   BusGpsPing model tagged @@schema("fleet") (was public).
--
-- Vehicle filter — every current bus-ops query already filters by
-- vehicle_id or schedule_id (schedule_id being the trip which itself
-- resolves to a single vehicle). No unfiltered scans of the table exist
-- in the codebase.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'bus_gps_pings') THEN
    EXECUTE 'ALTER TABLE public.bus_gps_pings SET SCHEMA fleet';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS fleet.bus_gps_pings (
  id            TEXT PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  tenant_id     TEXT,
  vehicle_id    TEXT NOT NULL,
  schedule_id   TEXT,
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  speed_kmh     DOUBLE PRECISION,
  heading_deg   DOUBLE PRECISION,
  accuracy_m    DOUBLE PRECISION,
  occurred_at   TIMESTAMPTZ NOT NULL,
  source        TEXT
);

CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_vehicle_occurred
  ON fleet.bus_gps_pings (vehicle_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_schedule_occurred
  ON fleet.bus_gps_pings (schedule_id, occurred_at);
