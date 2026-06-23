-- Multi-tenant data isolation: add tenant_id to every GORM-managed table
-- the Go backend reads or writes through. After this migration, every row
-- in the fleet domain belongs to exactly one tenant, and the Go side's
-- forthcoming GORM scope (Phase 2d) will inject `WHERE tenant_id = ?` on
-- every query. Combined with the JWT middleware (Phase 2a) that pins
-- tenant_id from the validated token, this is the enterprise pattern: no
-- handler can accidentally cross tenant boundaries, even when a developer
-- forgets to scope a query.
--
-- Migration shape (per table):
--   1) ADD COLUMN tenant_id TEXT                  (nullable initially)
--   2) UPDATE backfill from oldest active tenant  (idempotent; no-op on
--                                                  fresh DB / empty table)
--   3) ALTER ... SET NOT NULL                     (loud failure if any
--                                                  row remained NULL)
--   4) ADD FK to tenants(id) ON DELETE RESTRICT   (RESTRICT — never
--                                                  cascade-delete tenant
--                                                  data; operators must
--                                                  retire records first)
--   5) CREATE INDEX on tenant_id                  (every query filters
--                                                  by it, so index is
--                                                  required, not optional)
--
-- Each UPDATE uses an inline subquery (rather than caching the default
-- tenant via set_config / current_setting) because Prisma's migration
-- runner sends each statement as a separate execute call — session-local
-- settings don't survive between statements. The subquery makes each
-- UPDATE fully self-contained.
--
-- If no active tenant exists when backfill rows are present, the SET NOT
-- NULL step on the first affected table will raise — operators must
-- provision a tenant first, then re-run.

-- Pre-flight: if any fleet table has rows but no active tenant exists,
-- fail loudly with a clear remediation rather than letting SET NOT NULL
-- produce a cryptic error mid-migration.
DO $$
DECLARE
  has_default_tenant BOOLEAN;
  has_any_data BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM tenants
    WHERE COALESCE(is_active, TRUE) = TRUE
  ) INTO has_default_tenant;

  SELECT EXISTS (
    SELECT 1 FROM vehicles UNION ALL
    SELECT 1 FROM drivers  UNION ALL
    SELECT 1 FROM garages  UNION ALL
    SELECT 1 FROM maintenance_requests UNION ALL
    SELECT 1 FROM histories UNION ALL
    SELECT 1 FROM service_requests UNION ALL
    SELECT 1 FROM quotations UNION ALL
    SELECT 1 FROM alerts UNION ALL
    SELECT 1 FROM alert_configs UNION ALL
    SELECT 1 FROM attachments UNION ALL
    SELECT 1 FROM comments
  ) INTO has_any_data;

  IF NOT has_default_tenant AND has_any_data THEN
    RAISE EXCEPTION
      'add_tenant_id migration: data exists in fleet tables but no active tenant found. Provision a tenant first (INSERT INTO tenants ...), then re-run.';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- vehicles
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "vehicles" ADD COLUMN "tenant_id" TEXT;
UPDATE "vehicles" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "vehicles" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "vehicles" ADD CONSTRAINT "fk_vehicles_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_vehicles_tenant_id" ON "vehicles"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- drivers
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "drivers" ADD COLUMN "tenant_id" TEXT;
UPDATE "drivers" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "drivers" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "drivers" ADD CONSTRAINT "fk_drivers_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_drivers_tenant_id" ON "drivers"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- garages
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "garages" ADD COLUMN "tenant_id" TEXT;
UPDATE "garages" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "garages" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "garages" ADD CONSTRAINT "fk_garages_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_garages_tenant_id" ON "garages"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- maintenance_requests
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "maintenance_requests" ADD COLUMN "tenant_id" TEXT;
UPDATE "maintenance_requests" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "maintenance_requests" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "fk_maintenance_requests_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_maintenance_requests_tenant_id" ON "maintenance_requests"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- histories (StatusHistory model)
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "histories" ADD COLUMN "tenant_id" TEXT;
UPDATE "histories" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "histories" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "histories" ADD CONSTRAINT "fk_histories_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_histories_tenant_id" ON "histories"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- service_requests
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "service_requests" ADD COLUMN "tenant_id" TEXT;
UPDATE "service_requests" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "service_requests" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "service_requests" ADD CONSTRAINT "fk_service_requests_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_service_requests_tenant_id" ON "service_requests"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- quotations
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "quotations" ADD COLUMN "tenant_id" TEXT;
UPDATE "quotations" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "quotations" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "quotations" ADD CONSTRAINT "fk_quotations_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_quotations_tenant_id" ON "quotations"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- alerts
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "alerts" ADD COLUMN "tenant_id" TEXT;
UPDATE "alerts" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "alerts" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "alerts" ADD CONSTRAINT "fk_alerts_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_alerts_tenant_id" ON "alerts"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- alert_configs
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "alert_configs" ADD COLUMN "tenant_id" TEXT;
UPDATE "alert_configs" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "alert_configs" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "alert_configs" ADD CONSTRAINT "fk_alert_configs_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_alert_configs_tenant_id" ON "alert_configs"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- attachments
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "attachments" ADD COLUMN "tenant_id" TEXT;
UPDATE "attachments" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "attachments" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "attachments" ADD CONSTRAINT "fk_attachments_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_attachments_tenant_id" ON "attachments"("tenant_id");

-- ────────────────────────────────────────────────────────────────────────
-- comments
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "comments" ADD COLUMN "tenant_id" TEXT;
UPDATE "comments" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "comments" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
CREATE INDEX "idx_comments_tenant_id" ON "comments"("tenant_id");
