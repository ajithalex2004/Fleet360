-- Closes the "route_optimisation_results" row from issue #77's audit.
--
-- 20260905000000_adopt_route_optimisation_results is already applied on
-- every real environment and is left untouched, same approach as every
-- migration in this series. Its own comment already documents the real
-- situation: "The table already existed in the database, unused (0 rows)
-- and absent from schema.prisma" — same untracked-legacy-table pattern as
-- trip_schedules/route_passengers, just never scoped as its own issue
-- until now. That migration only ALTERs an assumed-pre-existing table
-- (type-fix route_id, add tenant_id/stops_hash, add the FK, enable RLS);
-- on a fresh replay the table doesn't exist at all, so every statement in
-- it fails.
--
-- Recreated here with the exact live DDL (pg_dump'd from production,
-- including three indexes and the route_id UNIQUE constraint the tracked
-- migration never mentions creating — further confirming the table's
-- origin is entirely the untracked legacy path, not this migration).
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260905000000_adopt_route_optimisation_results

CREATE TABLE IF NOT EXISTS public.route_optimisation_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    route_id text NOT NULL REFERENCES public.bus_routes(id) ON DELETE CASCADE,
    route_name text,
    route_number text,
    original_stop_count integer DEFAULT 0 NOT NULL,
    matched_stop_count integer DEFAULT 0 NOT NULL,
    original_distance_km numeric(10,3) NOT NULL,
    optimised_distance_km numeric(10,3) NOT NULL,
    distance_saved_km numeric(10,3) NOT NULL,
    distance_saved_pct numeric(6,2) NOT NULL,
    iterations_2opt integer DEFAULT 0 NOT NULL,
    solver_duration_ms integer DEFAULT 0 NOT NULL,
    estimated_duration_min integer,
    original_sequence jsonb DEFAULT '[]'::jsonb NOT NULL,
    optimised_sequence jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'SUGGESTED'::text NOT NULL,
    applied_at timestamp with time zone,
    rejected_at timestamp with time zone,
    rejected_by text,
    agent_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text NOT NULL,
    stops_hash text,
    CONSTRAINT route_optimisation_results_route_id_key UNIQUE (route_id)
);

CREATE INDEX IF NOT EXISTS idx_route_opt_saved_pct ON public.route_optimisation_results USING btree (distance_saved_pct DESC);
CREATE INDEX IF NOT EXISTS idx_route_opt_status ON public.route_optimisation_results USING btree (status);
CREATE INDEX IF NOT EXISTS idx_route_opt_tenant_route ON public.route_optimisation_results USING btree (tenant_id, route_id);
CREATE INDEX IF NOT EXISTS idx_route_opt_updated_at ON public.route_optimisation_results USING btree (updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_optimisation_results TO fleet360_app;

ALTER TABLE public.route_optimisation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_optimisation_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.route_optimisation_results;
CREATE POLICY tenant_isolation ON public.route_optimisation_results FOR ALL
  USING (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
