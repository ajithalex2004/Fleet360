-- =====================================================================
-- Migration: Add workforce, fleet, operations logical schemas
-- =====================================================================
--
-- Extends the domain-schema pattern introduced in
-- 20260810000005_introduce_domain_schemas (which added finance, ai) with
-- three more schemas needed by the schema-domain-split epic:
--
--   workforce   — employee-scoped data (workforce.Employee, driver_performance)
--   fleet       — vehicle-scoped ingest and telemetry (bus_gps_pings)
--   operations  — cross-module operational events (incidents from all modules)
--
-- Tables are NOT moved by this migration — schema creation is a prereq for
-- later per-task migrations that ALTER TABLE ... SET SCHEMA one domain at
-- a time. Backward compatibility maintained through database role
-- search_path (see the phase-1 migration for the pattern).
--
-- Applied out-of-band via prisma/raw/*.sql because the shared dev DB has
-- lease_* drift blocking `prisma migrate dev`. Promote to a real Prisma
-- migration once drift is reconciled.

CREATE SCHEMA IF NOT EXISTS workforce;
CREATE SCHEMA IF NOT EXISTS fleet;
CREATE SCHEMA IF NOT EXISTS operations;

-- Grant baseline access to the app role. Tighter per-domain grants
-- (e.g. AI role restricted to public + ai only) are added in the
-- role-provisioning migration if/when adopted, mirroring
-- fleet360_api_role / fleet360_ai_role from the phase-1 migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
    GRANT USAGE, CREATE ON SCHEMA workforce  TO fleet360_api_role;
    GRANT USAGE, CREATE ON SCHEMA fleet      TO fleet360_api_role;
    GRANT USAGE, CREATE ON SCHEMA operations TO fleet360_api_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA workforce  GRANT ALL ON TABLES TO fleet360_api_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA fleet      GRANT ALL ON TABLES TO fleet360_api_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA operations GRANT ALL ON TABLES TO fleet360_api_role;
  END IF;
END $$;
