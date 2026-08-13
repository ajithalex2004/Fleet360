-- Shared geospatial primitive — spatial.places
--
-- Phase 1 of the shared geospatial capability. Creates the schema, the
-- table, indexes, RLS policy, and backfills existing bus_ops_geofences
-- rows so the two tables coexist while Phase 2 migrates consumers.
--
-- Old table (public.bus_ops_geofences) stays fully functional — this is
-- a data-preserving addition, not a rename. Every row that exists there
-- gets a corresponding Place row with source_module='bus-ops' and
-- source_id set to the original bus_ops_geofences.id so we can reconcile
-- edits made through either surface until cutover.

CREATE SCHEMA IF NOT EXISTS spatial;

CREATE TABLE IF NOT EXISTS spatial.places (
  id             TEXT PRIMARY KEY,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  tenant_id      TEXT NOT NULL,

  name           TEXT NOT NULL,
  code           TEXT,
  type           TEXT NOT NULL,
  shape          TEXT NOT NULL,
  description    TEXT,
  address        TEXT,

  center_lat     DOUBLE PRECISION,
  center_lng     DOUBLE PRECISION,
  radius_m       INTEGER,
  polygon        JSONB,

  metadata       JSONB,

  source_module  TEXT,
  source_id      TEXT,

  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     TEXT,
  updated_by     TEXT
);

CREATE INDEX IF NOT EXISTS idx_places_tenant_id    ON spatial.places(tenant_id);
CREATE INDEX IF NOT EXISTS idx_places_tenant_type  ON spatial.places(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_places_deleted_at   ON spatial.places(deleted_at);
CREATE INDEX IF NOT EXISTS idx_places_source       ON spatial.places(source_module, source_id);

-- Row-level security — tenant isolation via the app.tenant_id GUC.
-- Mirrors the pattern used in extend_rls_to_domain_schemas_and_new_tables.sql
-- so a query issued through withTenantRls() only sees its own tenant's rows.
ALTER TABLE spatial.places ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.places FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS places_tenant_isolation ON spatial.places;
CREATE POLICY places_tenant_isolation ON spatial.places
  USING (tenant_id = current_setting('app.tenant_id', TRUE))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE));

-- Backfill — copy every bus_ops_geofences row into spatial.places once.
-- Idempotent: the ON CONFLICT is on source_module + source_id, which is a
-- composite. Since there's no unique constraint yet, we filter with NOT
-- EXISTS instead so re-running is safe.
INSERT INTO spatial.places (
  id, created_at, updated_at, deleted_at, tenant_id,
  name, type, shape, address,
  center_lat, center_lng, radius_m, polygon,
  active, created_by, source_module, source_id
)
SELECT
  gen_random_uuid()::TEXT,
  g.created_at, g.updated_at, g.deleted_at, g.tenant_id,
  g.name, g.type, g.shape, g.address,
  g.center_lat, g.center_lng, g.radius_m, g.polygon,
  g.active, g.created_by, 'bus-ops', g.id::TEXT
FROM public.bus_ops_geofences g
WHERE NOT EXISTS (
  -- Cast g.id to TEXT: bus_ops_geofences.id is a native UUID column (Prisma
  -- shows it as String but the underlying type is uuid), whereas
  -- spatial.places.source_id is TEXT so we compare on the string form.
  SELECT 1 FROM spatial.places p
  WHERE p.source_module = 'bus-ops' AND p.source_id = g.id::TEXT
);

-- Grants — kept as plain statements (the ;\n splitter in the applier
-- can't handle a DO $$ ... $$ block). Neon runs the migration as the
-- schema owner, so `neondb_owner` already owns the objects created above
-- and the grants below are no-ops on that role; they're here so the same
-- SQL can be re-applied cleanly on other Postgres deployments where the
-- runtime role differs from the DDL role.
GRANT USAGE ON SCHEMA spatial TO neondb_owner;
GRANT ALL ON ALL TABLES IN SCHEMA spatial TO neondb_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA spatial GRANT ALL ON TABLES TO neondb_owner;
