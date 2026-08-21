-- Fleet Routing (VRPTW via Google Cloud Route Optimization) — foundation.
--
-- Adds:
--   • Time-window override columns on bus_routes, route_passengers, tenants.
--   • Five new tables: fleet_route_matrix_cache, fleet_optimization_runs,
--     fleet_optimization_run_routes, fleet_optimization_run_stops,
--     fleet_optimization_run_unassigned.
--
-- All additions are backward-compatible: nullable columns, new tables. No
-- existing row / index is touched. IF NOT EXISTS on every ALTER so re-running
-- against a partially-migrated environment is a no-op.
--
-- RLS: new tenant-scoped tables get USING + WITH CHECK policies + FORCE ROW
-- LEVEL SECURITY per KNOWN-TS-001 convention. Cross-tenant reads are impossible
-- without withPlatformAdmin scope; cross-tenant writes are blocked by WITH CHECK.

-- ── 1. Time-window overrides on existing models ─────────────────────────────

ALTER TABLE public.bus_routes
  ADD COLUMN IF NOT EXISTS pickup_buffer_min INTEGER;

ALTER TABLE public.route_passengers
  ADD COLUMN IF NOT EXISTS earliest_pickup        TEXT,
  ADD COLUMN IF NOT EXISTS latest_pickup          TEXT,
  ADD COLUMN IF NOT EXISTS required_arrival_time  TEXT,
  ADD COLUMN IF NOT EXISTS pickup_buffer_min      INTEGER;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS default_pickup_buffer_min     INTEGER,
  ADD COLUMN IF NOT EXISTS default_required_arrival_time TEXT;

-- ── 2. fleet_route_matrix_cache ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fleet_route_matrix_cache (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id         TEXT        NOT NULL,
  cache_key         TEXT        NOT NULL,
  origins_hash      TEXT        NOT NULL,
  destinations_hash TEXT        NOT NULL,
  routing_mode      TEXT        NOT NULL,
  traffic_bucket    TEXT        NOT NULL,
  route_modifiers   TEXT        NOT NULL,
  api_version       TEXT        NOT NULL,
  origins           JSONB       NOT NULL,
  destinations      JSONB       NOT NULL,
  matrix            JSONB       NOT NULL,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_fleet_route_matrix_tenant_key
  ON public.fleet_route_matrix_cache (tenant_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_fleet_route_matrix_computed
  ON public.fleet_route_matrix_cache (computed_at);

ALTER TABLE public.fleet_route_matrix_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_route_matrix_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY fleet_route_matrix_cache_tenant_isolation
  ON public.fleet_route_matrix_cache
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- ── 3. fleet_optimization_runs ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fleet_optimization_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  tenant_id       TEXT        NOT NULL,
  created_by      TEXT        NOT NULL,
  status          TEXT        NOT NULL,
  status_reason   TEXT,
  target_date     DATE        NOT NULL,
  input_snapshot  JSONB       NOT NULL,
  raw_response    JSONB,
  metrics         JSONB,
  error_message   TEXT,
  published_at    TIMESTAMPTZ,
  published_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_tenant
  ON public.fleet_optimization_runs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_target_date
  ON public.fleet_optimization_runs (target_date);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_status
  ON public.fleet_optimization_runs (status);

ALTER TABLE public.fleet_optimization_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_optimization_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY fleet_optimization_runs_tenant_isolation
  ON public.fleet_optimization_runs
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- ── 4. fleet_optimization_run_routes ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fleet_optimization_run_routes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id           TEXT        NOT NULL,
  run_id              UUID        NOT NULL REFERENCES public.fleet_optimization_runs(id) ON DELETE CASCADE,
  vehicle_id          TEXT        NOT NULL,
  driver_id           TEXT,
  sequence_in_run     INTEGER     NOT NULL,
  total_distance_km   DOUBLE PRECISION NOT NULL,
  total_duration_min  INTEGER     NOT NULL,
  total_passengers    INTEGER     NOT NULL,
  encoded_polyline    TEXT        NOT NULL,
  start_time          TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_route_run
  ON public.fleet_optimization_run_routes (run_id);
CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_route_vehicle
  ON public.fleet_optimization_run_routes (tenant_id, vehicle_id);

ALTER TABLE public.fleet_optimization_run_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_optimization_run_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY fleet_optimization_run_routes_tenant_isolation
  ON public.fleet_optimization_run_routes
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- ── 5. fleet_optimization_run_stops ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fleet_optimization_run_stops (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id        TEXT        NOT NULL,
  run_route_id     UUID        NOT NULL REFERENCES public.fleet_optimization_run_routes(id) ON DELETE CASCADE,
  sequence         INTEGER     NOT NULL,
  stop_id          TEXT,
  lat              DOUBLE PRECISION NOT NULL,
  lng              DOUBLE PRECISION NOT NULL,
  label            TEXT        NOT NULL,
  arrival_time     TIMESTAMPTZ NOT NULL,
  departure_time   TIMESTAMPTZ NOT NULL,
  passenger_count  INTEGER     NOT NULL,
  passenger_ids    JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_stop_route_seq
  ON public.fleet_optimization_run_stops (run_route_id, sequence);

ALTER TABLE public.fleet_optimization_run_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_optimization_run_stops FORCE ROW LEVEL SECURITY;
CREATE POLICY fleet_optimization_run_stops_tenant_isolation
  ON public.fleet_optimization_run_stops
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- ── 6. fleet_optimization_run_unassigned ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fleet_optimization_run_unassigned (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id      TEXT        NOT NULL,
  run_id         UUID        NOT NULL REFERENCES public.fleet_optimization_runs(id) ON DELETE CASCADE,
  passenger_id   TEXT,
  stop_lat       DOUBLE PRECISION NOT NULL,
  stop_lng       DOUBLE PRECISION NOT NULL,
  stop_label     TEXT        NOT NULL,
  reason         TEXT        NOT NULL,
  reason_detail  TEXT
);

CREATE INDEX IF NOT EXISTS idx_fleet_opt_run_unassigned_run
  ON public.fleet_optimization_run_unassigned (run_id);

ALTER TABLE public.fleet_optimization_run_unassigned ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_optimization_run_unassigned FORCE ROW LEVEL SECURITY;
CREATE POLICY fleet_optimization_run_unassigned_tenant_isolation
  ON public.fleet_optimization_run_unassigned
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
