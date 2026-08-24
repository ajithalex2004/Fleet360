-- Adds the breakdown-reports feature to the database.
--
-- WHY THIS EXISTS
-- The BreakdownReport model and MaintenanceRequest.breakdownReportId were added
-- to prisma/schema.prisma in commit 1076535b, but no migration was ever
-- generated. The table and column have therefore never existed in the database,
-- while /api/maintenance/breakdown-reports/* and the Maintenance > Breakdowns UI
-- ship against them. The visible symptom is that GET /api/maintenance-requests
-- returns 500 with Prisma P2022:
--   The column `maintenance_requests.breakdown_report_id` does not exist
-- because Prisma selects every scalar field of the model.
--
-- SCOPE: STRICTLY ADDITIVE.
-- This migration is hand-written rather than generated on purpose. Running
-- `prisma migrate diff` against this database emits ~2541 lines containing 657
-- DROP statements (174 DROP TABLE), because prisma/schema.prisma does not model
-- large parts of the live database — it would drop finance.finance_chart_of_accounts,
-- the Workflow* tables, the admin_* tables and many others. None of that belongs
-- in this change, so only the breakdown-reports objects are included here.
--
-- Every statement is idempotent (IF NOT EXISTS / guarded DO blocks) so this is
-- safe to re-run and safe on environments where the objects already exist.

-- 1. The breakdown_reports table.
CREATE TABLE IF NOT EXISTS "public"."breakdown_reports" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "report_no" TEXT,
    "tenant_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "driver_id" TEXT,
    "reported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "breakdown_type" TEXT NOT NULL DEFAULT 'OTHER',
    "location" TEXT,
    "latitude" DECIMAL,
    "longitude" DECIMAL,
    "driver_notes" TEXT,
    "photo_urls" JSONB DEFAULT '[]',
    "severity" TEXT NOT NULL DEFAULT 'HIGH',
    "status" TEXT NOT NULL DEFAULT 'REPORTED',
    "recovery_vehicle_id" TEXT,
    "recovery_driver_id" TEXT,
    "recovery_notes" TEXT,
    "recovery_dispatched_at" TIMESTAMPTZ(6),
    "recovery_completed_at" TIMESTAMPTZ(6),
    "estimated_arrival_at" TIMESTAMPTZ(6),
    "maintenance_request_id" TEXT,

    CONSTRAINT "breakdown_reports_pkey" PRIMARY KEY ("id")
);

-- 2. The missing column on maintenance_requests. This is the one that causes
--    the P2022 on every maintenance-requests read.
ALTER TABLE "public"."maintenance_requests"
  ADD COLUMN IF NOT EXISTS "breakdown_report_id" TEXT;

-- 3. Indexes, matching the @@index / @unique declarations on the model.
CREATE UNIQUE INDEX IF NOT EXISTS "breakdown_reports_report_no_key"
  ON "public"."breakdown_reports"("report_no");
CREATE UNIQUE INDEX IF NOT EXISTS "breakdown_reports_maintenance_request_id_key"
  ON "public"."breakdown_reports"("maintenance_request_id");
CREATE INDEX IF NOT EXISTS "idx_breakdown_reports_tenant_status"
  ON "public"."breakdown_reports"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_breakdown_reports_vehicle_id"
  ON "public"."breakdown_reports"("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_breakdown_reports_reported_at"
  ON "public"."breakdown_reports"("reported_at");
CREATE INDEX IF NOT EXISTS "idx_breakdown_reports_deleted_at"
  ON "public"."breakdown_reports"("deleted_at");

-- 4. FK back to maintenance_requests, matching the `breakdown_mr` relation.
--    Guarded because ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'breakdown_reports_maintenance_request_id_fkey'
  ) THEN
    ALTER TABLE "public"."breakdown_reports"
      ADD CONSTRAINT "breakdown_reports_maintenance_request_id_fkey"
      FOREIGN KEY ("maintenance_request_id")
      REFERENCES "public"."maintenance_requests"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- 5. Tenant isolation. breakdown_reports carries tenant_id, so it needs the
--    same RLS treatment every other tenant table gets — see
--    20260902000000_p0_apply_rls_all_tables. USING gates reads; WITH CHECK
--    blocks cross-tenant INSERT/UPDATE. Both are required. FORCE makes the
--    policy apply to the table owner too, which is how the app connects.
ALTER TABLE "public"."breakdown_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."breakdown_reports" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "public"."breakdown_reports";
CREATE POLICY tenant_isolation ON "public"."breakdown_reports" FOR ALL
USING (
  current_setting('app.tenant_id', true) = '*'
  OR tenant_id = current_setting('app.tenant_id', true)
)
WITH CHECK (
  current_setting('app.tenant_id', true) = '*'
  OR tenant_id = current_setting('app.tenant_id', true)
);
