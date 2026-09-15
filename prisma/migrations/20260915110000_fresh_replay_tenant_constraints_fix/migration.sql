-- Closes the "work_orders" row from issue #77's audit.
--
-- 20260824000000_add_tenant_constraints_and_indexes is already applied on
-- every real environment and is left untouched, same approach as every
-- migration in this series. But this one isn't the same class of bug as
-- #73/#75/#76 (a legacy table that exists live but was never tracked) —
-- it's a genuine typo in the original migration. Confirmed directly
-- against the live database:
--
--   * "work_orders" (lowercase, the name this migration's last 3
--     statements quote) has never existed anywhere, including production.
--   * "WorkOrder" (the real table — Prisma's default PascalCase name for
--     the WorkOrder model, created by the very first tracked migration)
--     already has tenant_id NOT NULL and a constraint literally named
--     fk_work_orders_tenant live — proving this migration's WorkOrder
--     section (the 5 statements just above the broken ones) already
--     succeeded correctly using the right table name.
--
-- Because Prisma applies a whole migration file as one transaction, the
-- three broken "work_orders" statements at the end force a rollback of
-- the entire file on a fresh replay — including the customers,
-- trip_passengers, and WorkOrder hardening that precedes them and is
-- otherwise completely correct. This migration redoes exactly that: the
-- real, correct work the original file did, verbatim, with the
-- erroneous "work_orders" statements simply omitted (their intent was
-- already covered by the WorkOrder statements — there was never a
-- second table to harden).
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260824000000_add_tenant_constraints_and_indexes

-- ── customers ────────────────────────────────────────────────────────────────

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

UPDATE "customers"
SET "tenant_id" = (
  SELECT id FROM tenants
  WHERE COALESCE(is_active, TRUE) = TRUE
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
)
WHERE "tenant_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "customers" WHERE "tenant_id" IS NULL) THEN
    RAISE NOTICE 'SKIP customers.tenant_id SET NOT NULL — NULL rows remain (no tenant exists yet on a fresh DB)';
  ELSE
    ALTER TABLE "customers" ALTER COLUMN "tenant_id" SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_customers_tenant_id"
  ON "customers"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_customers_tenant'
  ) THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "fk_customers_tenant"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
  END IF;
END $$;

-- ── trip_passengers ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trip_passengers' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE "trip_passengers" ADD COLUMN "tenant_id" TEXT;

    UPDATE "trip_passengers"
    SET "tenant_id" = (
      SELECT id FROM tenants
      WHERE COALESCE(is_active, TRUE) = TRUE
      ORDER BY created_at ASC NULLS LAST
      LIMIT 1
    )
    WHERE "tenant_id" IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM "trip_passengers" WHERE "tenant_id" IS NULL) THEN
    RAISE NOTICE 'SKIP trip_passengers.tenant_id SET NOT NULL — NULL rows remain';
  ELSE
    ALTER TABLE "trip_passengers" ALTER COLUMN "tenant_id" SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_trip_passengers_tenant_id"
  ON "trip_passengers"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_trip_passengers_tenant'
  ) THEN
    ALTER TABLE "trip_passengers"
      ADD CONSTRAINT "fk_trip_passengers_tenant"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
  END IF;
END $$;

-- ── "WorkOrder" — the real table. No "work_orders" statements here; that
-- name has never existed and this table's own hardening already covers
-- everything the broken lines were trying to (redundantly, incorrectly)
-- also do. ────────────────────────────────────────────────────────────────

ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

UPDATE "WorkOrder" wo
SET "tenant_id" = mr."tenant_id"
FROM "maintenance_requests" mr
WHERE wo."requestId" = mr."id" AND wo."tenant_id" IS NULL;

UPDATE "WorkOrder"
SET "tenant_id" = (
  SELECT id FROM tenants
  WHERE COALESCE(is_active, TRUE) = TRUE
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
)
WHERE "tenant_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "WorkOrder" WHERE "tenant_id" IS NULL) THEN
    RAISE NOTICE 'SKIP "WorkOrder".tenant_id SET NOT NULL — NULL rows remain';
  ELSE
    ALTER TABLE "WorkOrder" ALTER COLUMN "tenant_id" SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_work_orders_tenant_id"
  ON "WorkOrder"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_work_orders_tenant'
  ) THEN
    ALTER TABLE "WorkOrder"
      ADD CONSTRAINT "fk_work_orders_tenant"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
  END IF;
END $$;
