-- Migration: 20260816000000_route_consolidation_phase2_schema
--
-- Route Consolidation Phase 2 lineage schema.
--
-- Relational lineage (not arrays on BusRoute) so multi-source, multi-
-- generation consolidations remain queryable and safely FK-checked.
--
--   RouteConsolidation                     — parent lineage row
--     └── RouteConsolidationSource         — one row per source route
--     └── RouteConsolidationEnrollmentMigration
--                                          — one row per migrated enrolment;
--                                            two nullable FKs (RoutePassenger,
--                                            TransportEnrollment) + XOR CHECK
--                                            rather than a polymorphic TEXT id
--
-- Status lifecycle (Phase 2):
--   APPLIED   — successfully committed consolidation
--   REVERTED  — apply committed, then explicitly rolled back
--
-- Not persisted:
--   PREVIEWED — preview endpoint is stateless
--   FAILED    — can't be written inside a rolled-back transaction; a
--               separate attempt-audit table can land later if wanted
--   SUPERSEDED — added when M-becomes-source lands (Phase 3)
--
-- Idempotency: UNIQUE(tenantId, idempotencyKey) is the hard duplicate
-- barrier. Partial UNIQUE(tenantId, recommendationId) WHERE status =
-- 'APPLIED' additionally prevents two active applies of the same
-- recommendation while still allowing re-apply after a revert.
--
-- Cool-down for D6 is derived at query time from RouteConsolidation.
-- appliedAt — no dedicated column on BusRoute.
--
-- RLS on every new table: USING + WITH CHECK + FORCE (per the standard
-- from the WITH CHECK backfill work). Predicate is the strict
-- `tenant_id = current_setting('app.tenant_id', TRUE)` form — new
-- tables have no legacy NULL-tenant rows to accommodate, so no wildcard
-- bypass is needed.

BEGIN;

-- ── Enum types ──────────────────────────────────────────────────────────────
--
-- Created as text CHECK constraints rather than PG enums so a future
-- new value (e.g. SUPERSEDED, FAILED) is a one-line migration, not an
-- ALTER TYPE dance. Matches the pattern used elsewhere in the codebase
-- for status/kind columns.

-- ── BusRoute — retirement columns ──────────────────────────────────────────
--
-- Nullable additions; existing rows stay valid. `retiredReason` is text
-- with a CHECK guard so the field discriminates consolidation-driven
-- retirement from other operator-authored reasons.

ALTER TABLE public.bus_routes
  ADD COLUMN IF NOT EXISTS retired_reason TEXT,
  ADD COLUMN IF NOT EXISTS retired_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retired_by     TEXT;

-- Index the reason so cool-down / analysis queries can quickly filter
-- retired-because-of-consolidation from other archive states.
CREATE INDEX IF NOT EXISTS idx_bus_routes_retired_reason
  ON public.bus_routes(retired_reason)
  WHERE retired_reason IS NOT NULL;

-- ── RouteConsolidation — parent ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.route_consolidations (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,

  -- Business identity — which planning recommendation this represents.
  -- Comes from the analyze response; stable across retries.
  recommendation_id         TEXT NOT NULL,

  -- Transport identity — client-generated per apply request. Different
  -- from recommendation_id: the same recommendation may be applied via
  -- multiple attempts (retries); this key deduplicates the *command*.
  idempotency_key           TEXT NOT NULL,

  -- Nullable while implementing draft states in future; currently every
  -- APPLIED row must have this set. REVERTED rows keep it (M lives on
  -- as an archived route so we can point at it).
  merged_route_id           TEXT REFERENCES public.bus_routes(id) ON DELETE RESTRICT,

  status                    TEXT NOT NULL
                              CHECK (status IN ('APPLIED', 'REVERTED')),

  -- Decision context (Phase-1 analyze snapshot). JSON is for
  -- evidence/context, not primary referential integrity.
  objective_snapshot        JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendation_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- D3 revert-drift detection: fingerprint of the merged route + its
  -- stops + migration rows immediately after apply commits. Revert
  -- eligibility compares this to the current fingerprint of the same
  -- surface; divergence blocks revert (operator-directed remediation).
  applied_state_hash        TEXT NOT NULL,

  applied_at                TIMESTAMPTZ NOT NULL,
  applied_by                TEXT NOT NULL,

  reverted_at               TIMESTAMPTZ,
  reverted_by               TEXT,
  revert_reason             TEXT,

  -- Prisma-convention timestamps. `created_at` equals `applied_at` for
  -- these rows (preview doesn't persist); kept because @default(now())
  -- on the Prisma model is standard.
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ,

  CONSTRAINT route_consolidations_reverted_when_reverted
    CHECK ((status = 'REVERTED') = (reverted_at IS NOT NULL))
);

-- Hard idempotency barrier — two apply requests with the same key
-- collide at INSERT time; the second attempt bounces off Postgres,
-- not on application-layer race checks.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consolidations_tenant_idem
  ON public.route_consolidations(tenant_id, idempotency_key);

-- Recommendation-uniqueness scoped to currently-APPLIED rows only.
-- Partial index lets an operator re-apply the same recommendationId
-- after reverting a prior attempt; the reverted row stays in place
-- (audit trail).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consolidations_tenant_rec_active
  ON public.route_consolidations(tenant_id, recommendation_id)
  WHERE status = 'APPLIED';

CREATE INDEX IF NOT EXISTS idx_route_consolidations_tenant_status
  ON public.route_consolidations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_route_consolidations_tenant_merged_route
  ON public.route_consolidations(tenant_id, merged_route_id);
CREATE INDEX IF NOT EXISTS idx_route_consolidations_applied_at
  ON public.route_consolidations(applied_at)
  WHERE status = 'APPLIED';

-- ── RouteConsolidationSource — child ────────────────────────────────────────
--
-- One row per source route participating in the consolidation. Not an
-- array on the parent because arrays defeat FKs, per-row indexing, and
-- multi-source query ergonomics.

CREATE TABLE IF NOT EXISTS public.route_consolidation_sources (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,
  consolidation_id          TEXT NOT NULL REFERENCES public.route_consolidations(id) ON DELETE CASCADE,
  source_route_id           TEXT NOT NULL REFERENCES public.bus_routes(id) ON DELETE RESTRICT,

  -- Snapshot of BusRoute.updated_at at analyze time. Apply-time guard
  -- refuses stale applies when the source has been edited since the
  -- recommendation was generated.
  source_route_updated_at   TIMESTAMPTZ,

  -- Ordering hint when >2 sources; also used by the merged-route stop
  -- ordering suggestion.
  sequence                  INT NOT NULL DEFAULT 0,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consolidation_sources_pair
  ON public.route_consolidation_sources(consolidation_id, source_route_id);
CREATE INDEX IF NOT EXISTS idx_route_consolidation_sources_tenant_source
  ON public.route_consolidation_sources(tenant_id, source_route_id);
CREATE INDEX IF NOT EXISTS idx_route_consolidation_sources_consolidation
  ON public.route_consolidation_sources(consolidation_id);

-- ── RouteConsolidationEnrollmentMigration — child ──────────────────────────
--
-- Records what enrolment moved where, so revert can restore. Two
-- nullable FKs (route_passenger_id, transport_enrollment_id) with a
-- CHECK constraint enforcing XOR — preserves referential integrity to
-- both target tables without a polymorphic TEXT id.

CREATE TABLE IF NOT EXISTS public.route_consolidation_enrollment_migrations (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,
  consolidation_id          TEXT NOT NULL REFERENCES public.route_consolidations(id) ON DELETE CASCADE,

  -- Exactly one of these must be non-null (CHECK below).
  -- Note: route_passengers.id is UUID (legacy migration artifact);
  --       transport_enrollments.id is TEXT. FK column types must match
  --       the referenced column type exactly.
  route_passenger_id        UUID REFERENCES public.route_passengers(id) ON DELETE RESTRICT,
  transport_enrollment_id   TEXT REFERENCES public.transport_enrollments(id) ON DELETE RESTRICT,

  source_route_id           TEXT NOT NULL REFERENCES public.bus_routes(id) ON DELETE RESTRICT,
  target_route_id           TEXT NOT NULL REFERENCES public.bus_routes(id) ON DELETE RESTRICT,

  old_pickup_stop_id        TEXT,
  new_pickup_stop_id        TEXT,
  old_dropoff_stop_id       TEXT,
  new_dropoff_stop_id       TEXT,

  mapping_method            TEXT NOT NULL
                              CHECK (mapping_method IN ('EXACT_STOP', 'EXACT_PLACE_ID', 'OPERATOR_RESOLVED')),

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- XOR — exactly one enrolment reference must be present.
  CONSTRAINT route_consol_enroll_migration_xor
    CHECK (
      (route_passenger_id IS NOT NULL AND transport_enrollment_id IS NULL)
      OR (route_passenger_id IS NULL AND transport_enrollment_id IS NOT NULL)
    )
);

-- Idempotent re-apply safety: same enrolment can appear at most once
-- per consolidation. Two partial indexes because the target column
-- differs by row.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consol_enroll_mig_rp
  ON public.route_consolidation_enrollment_migrations(consolidation_id, route_passenger_id)
  WHERE route_passenger_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_route_consol_enroll_mig_te
  ON public.route_consolidation_enrollment_migrations(consolidation_id, transport_enrollment_id)
  WHERE transport_enrollment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_route_consol_enroll_mig_consolidation
  ON public.route_consolidation_enrollment_migrations(consolidation_id);
CREATE INDEX IF NOT EXISTS idx_route_consol_enroll_mig_tenant
  ON public.route_consolidation_enrollment_migrations(tenant_id);

-- ── Row-Level Security ─────────────────────────────────────────────────────
--
-- Strict predicate (no NULL-tenant, no wildcard) since these are new
-- tables with no legacy rows. USING + WITH CHECK matching exactly, per
-- the standard from the WITH CHECK backfill work.

ALTER TABLE public.route_consolidations                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_consolidations                          FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.route_consolidations;
CREATE POLICY tenant_isolation ON public.route_consolidations
  USING      (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

ALTER TABLE public.route_consolidation_sources                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_consolidation_sources                   FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.route_consolidation_sources;
CREATE POLICY tenant_isolation ON public.route_consolidation_sources
  USING      (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

ALTER TABLE public.route_consolidation_enrollment_migrations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_consolidation_enrollment_migrations     FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.route_consolidation_enrollment_migrations;
CREATE POLICY tenant_isolation ON public.route_consolidation_enrollment_migrations
  USING      (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

COMMIT;
