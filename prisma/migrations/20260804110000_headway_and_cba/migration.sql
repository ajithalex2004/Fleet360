-- =====================================================================
-- Phase 1: Headway management + CBA rule engine
-- =====================================================================
--
-- Two new tables plus one column on trip_schedules:
--
--   1. headway_rules        — time-window × headway-interval rules
--                              (per route + day-mask + optional anchor).
--                              Powers both live "next bus" expansion on
--                              the passenger page and the Planning Core's
--                              batch-expansion target.
--
--   2. cba_rule_sets        — named bundles of labour rules (work hours,
--                              OT threshold, min rest, etc.) that the
--                              Planning Core reads as runcut work-rules.
--                              Linked from headway_rules.cba_rule_set_id
--                              and (later) from routes.
--
--   3. trip_schedules.scheduling_mode  — TIMEPOINT (default) | HEADWAY.
--                              A row in HEADWAY mode is a template; live
--                              views expand it from headway_rules.
--
-- RLS: same tenant-isolation pattern as the rest of bus-ops. Super
-- admin can read/write across tenants via withPlatformAdmin.
-- =====================================================================

-- ── 1) trip_schedules.scheduling_mode ──────────────────────────────────────
ALTER TABLE trip_schedules
  ADD COLUMN IF NOT EXISTS scheduling_mode TEXT NOT NULL DEFAULT 'TIMEPOINT';

-- Backfill comment (column is non-null, so default is safe).
-- The default is TIMEPOINT, which preserves existing behaviour.

-- ── 2) cba_rule_sets (must come before headway_rules — FK) ────────────────
CREATE TABLE IF NOT EXISTS cba_rule_sets (
  id              TEXT PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  tenant_id       TEXT,

  name            TEXT NOT NULL,
  description     TEXT,
  jurisdiction    TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  is_system       BOOLEAN NOT NULL DEFAULT false,

  rules           JSONB NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1
);

-- Only one default rule-set per tenant. Enforced via a partial unique
-- index. NULL tenants (super-admin owned rule-sets) are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cba_default_per_tenant
  ON cba_rule_sets (tenant_id)
  WHERE is_default = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cba_tenant ON cba_rule_sets (tenant_id);

ALTER TABLE cba_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cba_rule_sets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cba_tenant_isolation ON cba_rule_sets;
CREATE POLICY cba_tenant_isolation ON cba_rule_sets
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- ── 3) headway_rules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS headway_rules (
  id                TEXT PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  tenant_id         TEXT,

  route_id          TEXT NOT NULL,
  trip_id           TEXT,
  day_mask          TEXT NOT NULL DEFAULT 'YYYYYYY',
  start_time        TEXT NOT NULL,                          -- 'HH:MM'
  end_time          TEXT NOT NULL,                          -- 'HH:MM'
  headway_minutes   INTEGER NOT NULL CHECK (headway_minutes BETWEEN 1 AND 240),
  anchor_time       TEXT,                                    -- 'HH:MM'
  cba_rule_set_id   TEXT,
  notes             TEXT,

  CONSTRAINT fk_headway_route
    FOREIGN KEY (route_id) REFERENCES bus_routes(id) ON DELETE CASCADE,
  CONSTRAINT fk_headway_trip
    FOREIGN KEY (trip_id) REFERENCES trip_schedules(id) ON DELETE SET NULL,
  CONSTRAINT fk_headway_cba
    FOREIGN KEY (cba_rule_set_id) REFERENCES cba_rule_sets(id) ON DELETE SET NULL,

  CONSTRAINT headway_window_check
    CHECK (start_time ~ '^\d{2}:\d{2}$' AND end_time ~ '^\d{2}:\d{2}$')
);

CREATE INDEX IF NOT EXISTS idx_headway_route     ON headway_rules (tenant_id, route_id);
CREATE INDEX IF NOT EXISTS idx_headway_cba       ON headway_rules (tenant_id, cba_rule_set_id);
CREATE INDEX IF NOT EXISTS idx_headway_route_nd  ON headway_rules (route_id) WHERE deleted_at IS NULL;

ALTER TABLE headway_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE headway_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS headway_tenant_isolation ON headway_rules;
CREATE POLICY headway_tenant_isolation ON headway_rules
  USING (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
