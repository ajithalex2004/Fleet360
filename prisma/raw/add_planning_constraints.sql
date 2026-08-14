-- Planning Constraint Engine — Phase 1 schema.
--
-- One polymorphic table (planning_constraints) holds every rule ops
-- authors — zone-time restrictions, pickup-time buffers, arrival SLAs,
-- max detour, max ride time, stop restrictions. The kind column
-- discriminates; params (JSONB) carries the kind-specific config so
-- new rule types don't need a schema change.
--
-- Plus: TripSchedule.latest_arrival_time — the "employees must reach
-- the workplace by X" hard deadline that turns arrivalTime from
-- estimate into commitment. Nullable so existing trips remain valid.

-- ── TripSchedule.latestArrivalTime ─────────────────────────────────
ALTER TABLE public.trip_schedules
  ADD COLUMN IF NOT EXISTS latest_arrival_time TIMESTAMPTZ;

-- ── planning_constraints ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.planning_constraints (
  id              TEXT PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  tenant_id       TEXT NOT NULL,

  name            TEXT NOT NULL,               -- human label, e.g. "Al Khail heavy-bus ban"
  /*
   * Rule kind. Determines how the evaluator interprets `params`.
   * Free text so a new kind lands with a code + evaluator, no DDL.
   *
   *   ZONE_VEHICLE_RESTRICTION   {zonePlaceId, minSeats?, maxSeats?,
   *                              vehicleGroups?, fromHm?, toHm?, dayMask?}
   *   PICKUP_TIME_BUFFER         {minBufferMin}   — between merge candidates
   *   TRIP_MAX_DURATION          {maxMinutes}
   *   PASSENGER_MAX_DETOUR       {maxMinutes | maxPercent}
   *   MERGED_ARRIVAL_SLA         {toleranceMin}   — vs latest_arrival_time
   *   ROUTE_STOP_RESTRICTION     {stopPlaceId, minSeats?, maxSeats?,
   *                              vehicleGroups?}
   *   VEHICLE_CAPACITY_HARD      {}               — legal capacity gate
   */
  kind            TEXT NOT NULL,
  /*
   * BLOCK   — plan is infeasible; optimiser never proposes it
   * WARN    — plan legal but flagged for operator attention
   * PENALTY — plan legal but scored; optimiser prefers lower total
   */
  action          TEXT NOT NULL DEFAULT 'BLOCK',
  /*
   * Penalty score for `action = PENALTY`. Additive across constraints.
   * Meaningful when the future optimiser compares candidates; ignored
   * by the pure evaluator except as diagnostic output.
   */
  penalty_score   NUMERIC(10, 2),

  /*
   * Kind-specific configuration. See kind comment for expected keys.
   * Validated at the evaluator level, not the DB. Prisma exposes as Json.
   */
  params          JSONB NOT NULL DEFAULT '{}',

  /*
   * Validity window. Rule is only active for evaluations whose
   * departureTime falls between effective_from and effective_to.
   * Null on either side = unbounded that direction.
   */
  effective_from  DATE,
  effective_to    DATE,

  reason          TEXT,                         -- shown to operators in the checks[] output
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      TEXT,
  updated_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_planning_constraints_tenant       ON public.planning_constraints(tenant_id);
CREATE INDEX IF NOT EXISTS idx_planning_constraints_tenant_kind  ON public.planning_constraints(tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_planning_constraints_deleted      ON public.planning_constraints(deleted_at);
CREATE INDEX IF NOT EXISTS idx_planning_constraints_enabled      ON public.planning_constraints(is_enabled);

-- Row-Level Security — tenant isolation via the app.tenant_id GUC.
-- Matches the pattern used by spatial.places / bus_ops_geofences.
ALTER TABLE public.planning_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planning_constraints FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planning_constraints_tenant_isolation ON public.planning_constraints;
CREATE POLICY planning_constraints_tenant_isolation ON public.planning_constraints
  USING (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));
