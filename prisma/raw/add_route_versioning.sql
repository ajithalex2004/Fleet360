-- Route Versioning + Direction Variants + Effective Dates
--
-- Introduces:
--   bus_route_variants          — named direction (Morning→Office, etc.) per route
--   bus_route_variant_versions  — immutable snapshot per (variant, versionNumber)
--
-- and extends:
--   route_stops.variant_version_id    — stops belong to a version, not a route
--   trip_schedules.route_variant_version_id
--                                     — trips snapshot the version they ran
--
-- ────────────────────────────────────────────────────────────────────────
-- Design
-- ────────────────────────────────────────────────────────────────────────
--
-- Route            = identity (BusRoute id, code, name)  — never versioned
--   ↓
-- Variant          = named direction / kind (Morning→Office, Weekend, …)
--                    Ongoing service concept. isActive gates whether new
--                    trips can be scheduled against it.
--   ↓
-- VariantVersion   = immutable snapshot with effectiveFrom / effectiveTo.
--                    Publishing a new version auto-closes the prior one's
--                    effectiveTo. Trips reference the version, so
--                    historical reporting sees the exact stops that ran.
--   ↓
-- RouteStop        = belongs to a version (via variant_version_id). Old
--                    route_id column stays populated for backward compat
--                    with pre-versioning readers.
--
-- ────────────────────────────────────────────────────────────────────────
-- Migration is CAPABILITY-ADDITIVE — no existing reader is changed. The
-- new columns are nullable; old writers keep hitting BusRoute + RouteStop
-- + TripSchedule fields as before. Phase 2 (documented in
-- FOLLOWUP_ROUTE_VERSIONING.md) migrates readers.

-- ── Variants ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bus_route_variants (
  id              TEXT PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  tenant_id       TEXT NOT NULL,
  route_id        TEXT NOT NULL,

  name            TEXT NOT NULL,     -- "Morning → Office", "Evening → Residence"
  /*
   * Canonical bucket for filtering / dispatch UI. Free-text so operators
   * can add new kinds without a schema change. Suggested values:
   *   MORNING | EVENING | INBOUND | OUTBOUND | WEEKEND | SPECIAL | NIGHT
   * Populated from the legacy TripSchedule.direction where possible.
   */
  kind            TEXT,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      TEXT,

  CONSTRAINT fk_bus_route_variants_route
    FOREIGN KEY (route_id) REFERENCES public.bus_routes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bus_route_variants_route     ON public.bus_route_variants(route_id);
CREATE INDEX IF NOT EXISTS idx_bus_route_variants_tenant    ON public.bus_route_variants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_route_variants_deleted   ON public.bus_route_variants(deleted_at);
-- One variant per (route, name) — prevents accidental duplicates from ops.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bus_route_variants_route_name
  ON public.bus_route_variants(route_id, name) WHERE deleted_at IS NULL;

-- ── Variant versions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bus_route_variant_versions (
  id                  TEXT PRIMARY KEY,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  tenant_id           TEXT NOT NULL,
  variant_id          TEXT NOT NULL,

  version_number      INTEGER NOT NULL,   -- 1, 2, 3, … per variant
  effective_from      DATE NOT NULL,
  effective_to        DATE,                -- null = still current

  /*
   * DRAFT     — being edited; not visible to schedulers
   * PUBLISHED — active; new trips reference this version until superseded
   * ARCHIVED  — superseded; historical trips still resolve, no new trips
   */
  status              TEXT NOT NULL DEFAULT 'DRAFT',
  published_at        TIMESTAMPTZ,
  published_by        TEXT,

  notes               TEXT,

  CONSTRAINT fk_bus_route_variant_versions_variant
    FOREIGN KEY (variant_id) REFERENCES public.bus_route_variants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bus_route_variant_versions_variant    ON public.bus_route_variant_versions(variant_id);
CREATE INDEX IF NOT EXISTS idx_bus_route_variant_versions_tenant     ON public.bus_route_variant_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_route_variant_versions_status     ON public.bus_route_variant_versions(status);
CREATE INDEX IF NOT EXISTS idx_bus_route_variant_versions_deleted    ON public.bus_route_variant_versions(deleted_at);
-- versionNumber is unique per variant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bus_route_variant_versions_variant_ver
  ON public.bus_route_variant_versions(variant_id, version_number);
-- At most one PUBLISHED version per variant at any time. Partial unique
-- index — DRAFT/ARCHIVED don't count.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bus_route_variant_versions_one_published
  ON public.bus_route_variant_versions(variant_id)
  WHERE status = 'PUBLISHED' AND deleted_at IS NULL;

-- ── Extend route_stops ────────────────────────────────────────────────
ALTER TABLE public.route_stops
  ADD COLUMN IF NOT EXISTS variant_version_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_route_stops_variant_version') THEN
    ALTER TABLE public.route_stops
      ADD CONSTRAINT fk_route_stops_variant_version FOREIGN KEY (variant_version_id)
      REFERENCES public.bus_route_variant_versions(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_route_stops_variant_version ON public.route_stops(variant_version_id);

-- ── Extend trip_schedules ─────────────────────────────────────────────
ALTER TABLE public.trip_schedules
  ADD COLUMN IF NOT EXISTS route_variant_version_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_trip_schedules_variant_version') THEN
    ALTER TABLE public.trip_schedules
      ADD CONSTRAINT fk_trip_schedules_variant_version FOREIGN KEY (route_variant_version_id)
      REFERENCES public.bus_route_variant_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trip_schedules_variant_version ON public.trip_schedules(route_variant_version_id);

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.bus_route_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bus_route_variants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bus_route_variants_tenant_isolation ON public.bus_route_variants;
CREATE POLICY bus_route_variants_tenant_isolation ON public.bus_route_variants
  USING (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

ALTER TABLE public.bus_route_variant_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bus_route_variant_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bus_route_variant_versions_tenant_isolation ON public.bus_route_variant_versions;
CREATE POLICY bus_route_variant_versions_tenant_isolation ON public.bus_route_variant_versions
  USING (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));
