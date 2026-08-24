-- Add tenant_id constraints and indexes for tables missing them
-- This migration handles tables that don't have tenant isolation migrations yet
--
-- Note: Most tables already have migrations (20260623140000 for fleet,
-- 20260815140000 for rental) but those haven't been applied yet.
-- This migration ONLY handles truly missing tables: Customer, TripPassenger, WorkOrder

-- ============================================================================
-- MISSING TABLES - Need full tenant isolation setup
-- ============================================================================

-- Customer: Add tenant_id column, backfill, NOT NULL, and index
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

-- Backfill existing rows with default tenant
UPDATE "customers"
SET "tenant_id" = (
  SELECT id FROM tenants
  WHERE COALESCE(is_active, TRUE) = TRUE
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
)
WHERE "tenant_id" IS NULL;

ALTER TABLE "customers"
  ALTER COLUMN "tenant_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_customers_tenant_id"
  ON "customers"("tenant_id");

ALTER TABLE "customers"
  ADD CONSTRAINT "fk_customers_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;

-- TripPassenger: Check if needs NOT NULL (may already have tenant_id from dispatch migration)
DO $$
BEGIN
  -- Only add if column doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trip_passengers'
    AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE "trip_passengers"
      ADD COLUMN "tenant_id" TEXT;

    UPDATE "trip_passengers"
    SET "tenant_id" = (
      SELECT id FROM tenants
      WHERE COALESCE(is_active, TRUE) = TRUE
      ORDER BY created_at ASC NULLS LAST
      LIMIT 1
    )
    WHERE "tenant_id" IS NULL;
  END IF;

  -- Ensure NOT NULL
  ALTER TABLE "trip_passengers"
    ALTER COLUMN "tenant_id" SET NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_trip_passengers_tenant_id"
  ON "trip_passengers"("tenant_id");

ALTER TABLE "trip_passengers"
  ADD CONSTRAINT "fk_trip_passengers_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;

-- WorkOrder: Add tenant_id column, backfill, NOT NULL, and index
ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

-- Backfill from maintenance_requests if possible, otherwise use default tenant
UPDATE "WorkOrder" wo
SET "tenant_id" = mr."tenant_id"
FROM "maintenance_requests" mr
WHERE wo."requestId" = mr."id" AND wo."tenant_id" IS NULL;

-- Fallback for any remaining NULL values
UPDATE "WorkOrder"
SET "tenant_id" = (
  SELECT id FROM tenants
  WHERE COALESCE(is_active, TRUE) = TRUE
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
)
WHERE "tenant_id" IS NULL;

ALTER TABLE "WorkOrder"
  ALTER COLUMN "tenant_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_work_orders_tenant_id"
  ON "WorkOrder"("tenant_id");

ALTER TABLE "WorkOrder"
  ADD CONSTRAINT "fk_work_orders_tenant"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
