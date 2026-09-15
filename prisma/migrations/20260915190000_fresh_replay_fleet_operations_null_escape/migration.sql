-- Closes the "20260910000008" row from issue #77's audit.
--
-- 20260910000008_fleet_operations_null_escape is already applied on every
-- real environment and is left untouched, same approach as every migration
-- in this series. Its own comments already document that fleet.bus_gps_pings
-- and operations.incidents are real, actively-used tables (TripIncident maps
-- to operations.incidents) that are simply off `search_path` — not that they
-- don't exist. On a fresh replay they genuinely don't exist though: no
-- tracked migration anywhere creates the `fleet`/`operations` schemas or
-- either table — same untracked-legacy pattern as
-- auth_login_attempts/route_optimisation_results/the three finance tables
-- closed earlier in this series, just never scoped as its own gap until now.
-- The migration's own `to_regclass(...) IS NULL THEN CONTINUE` guard means
-- its 2-table tighten loop silently no-ops on a fresh replay rather than
-- erroring — confirmed empirically (neither table exists at this point in a
-- paused fresh-replay run, and the loop produces no error before reaching
-- the verification below).
--
-- The actual failure is the migration's closing verification: a genuinely
-- global check, across every non-system schema, for any tenant_id-bearing
-- table still carrying a live NULL escape, allow-listing only 4 exceptions.
-- On live this holds because every tenant-owned table across every schema
-- already had RLS from the untracked legacy path from day one. On a fresh
-- replay it's inherently order-dependent on every other RLS-tightening
-- migration in this repository's history — including several dated AFTER
-- this one in tracked history (20260910000000, 20260910000004,
-- 20260910000006) and their corrective fresh-replay fixes earlier in this
-- series, which are necessarily dated even later still. Same reasoning as
-- 20260910000000/20260910000004/20260910000006's fixes, just the broadest
-- version of the same problem. Omitted here for the same reason.
--
-- Fix: recreate both tables with their exact live DDL (pg_dump'd from
-- production) — both already fully tightened there (tenant_id NOT NULL, RLS
-- enabled+forced, no-escape policy), so this creates them directly in that
-- end state rather than replaying a tighten step that live never needed
-- either. No loop, no verification — see above. Safe no-op on every real
-- environment, where both tables and their schemas already exist.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260910000008_fleet_operations_null_escape

CREATE SCHEMA IF NOT EXISTS fleet;
CREATE SCHEMA IF NOT EXISTS operations;

GRANT USAGE ON SCHEMA fleet      TO fleet360_app;
GRANT USAGE ON SCHEMA operations TO fleet360_app;

CREATE TABLE IF NOT EXISTS fleet.bus_gps_pings (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    tenant_id text NOT NULL,
    vehicle_id text NOT NULL,
    schedule_id text,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    speed_kmh double precision,
    heading_deg double precision,
    accuracy_m double precision,
    occurred_at timestamp with time zone NOT NULL,
    source text
);
CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_schedule_occurred ON fleet.bus_gps_pings USING btree (schedule_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_tenant_id ON fleet.bus_gps_pings USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_vehicle_occurred ON fleet.bus_gps_pings USING btree (vehicle_id, occurred_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON fleet.bus_gps_pings TO fleet360_app;
ALTER TABLE fleet.bus_gps_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.bus_gps_pings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fleet.bus_gps_pings;
CREATE POLICY tenant_isolation ON fleet.bus_gps_pings FOR ALL
  USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

-- Constraint/index names below (trip_incidents_pkey, trip_incidents_incident_no_key)
-- and the near-duplicate tenant_id indexes are reproduced exactly as they
-- exist live, including the leftover pre-rename naming — not cleaned up here.
CREATE TABLE IF NOT EXISTS operations.incidents (
    id text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp(6) with time zone,
    incident_no text,
    schedule_id text,
    route_id text,
    vehicle_id text,
    driver_id text,
    incident_date timestamp(6) with time zone NOT NULL,
    incident_type text NOT NULL,
    severity text DEFAULT 'LOW'::text,
    location text,
    description text,
    injuries_reported boolean DEFAULT false,
    police_report boolean DEFAULT false,
    police_report_no text,
    action_taken text,
    status text DEFAULT 'OPEN'::text,
    resolved_at timestamp(6) with time zone,
    resolved_by text,
    tenant_id uuid NOT NULL,
    module_source text DEFAULT 'BUS_OPS'::text NOT NULL,
    CONSTRAINT trip_incidents_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS trip_incidents_incident_no_key ON operations.incidents USING btree (incident_no);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_id ON operations.incidents USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_operations_incidents_module_source ON operations.incidents USING btree (module_source);
CREATE INDEX IF NOT EXISTS idx_operations_incidents_tenant ON operations.incidents USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trip_incidents_tenant_id ON operations.incidents USING btree (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON operations.incidents TO fleet360_app;
ALTER TABLE operations.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON operations.incidents;
CREATE POLICY tenant_isolation ON operations.incidents FOR ALL
  USING (current_setting('app.tenant_id', true) = '*' OR (tenant_id)::text = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = '*' OR (tenant_id)::text = current_setting('app.tenant_id', true));
