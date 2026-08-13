-- ============================================================
-- Restore schema fields the Layer 2.6 cleanup dropped, that the
-- route handlers still reference. Typecheck-only fix without this
-- migration would leave the Prisma client types in sync with the
-- schema but the DB columns missing — runtime INSERTs/UPDATEs
-- would fail at execution time.
--
-- Scope:
--   vat_returns    — period_start/period_end aliases, plus
--                    total_purchases / output_tax / input_tax /
--                    net_tax / submission_date / payment_date / notes
--                    (the route code references these by the alias
--                    names and the new columns)
--   finance_budgets — month becomes nullable, add notes
--   lease_contract_vehicles — add quantity
--   rental_agreements — add notes (the existing `remarks` field is
--                    kept for historical data; `notes` is the
--                    field the rental counter handover writes to)
--   vehicles — add is_active (boolean, default true). The field is
--                    NOT the same as `status` ('AVAILABLE' etc.) —
--                    the availability route filters on is_active.
--
-- Why this is a separate migration from the leasing tenant_id one:
--   This is a feature-restoration migration, not a security one.
--   It can be applied to fresh DBs without backfill (all columns
--   are nullable). For existing DBs, no data movement is needed —
--   the new columns are added as nullable, and route code that
--   reads them gets NULL for old rows (handled by the `?? null`
--   defaults in the route code).
-- ============================================================

-- -- vat_returns ----------------------------------------------------------
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "period_start"      TIMESTAMPTZ;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "period_end"        TIMESTAMPTZ;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "total_purchases"   DECIMAL;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "output_tax"        DECIMAL;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "input_tax"         DECIMAL;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "net_tax"           DECIMAL;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "submission_date"   TIMESTAMPTZ;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "payment_date"      TIMESTAMPTZ;
ALTER TABLE "vat_returns" ADD COLUMN IF NOT EXISTS "notes"             TEXT;

-- -- finance_budgets ------------------------------------------------------
ALTER TABLE "finance_budgets" ALTER COLUMN "month" DROP NOT NULL;
ALTER TABLE "finance_budgets" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- -- lease_contract_vehicles ---------------------------------------------
ALTER TABLE "lease_contract_vehicles" ADD COLUMN IF NOT EXISTS "quantity" INTEGER;

-- -- rental_agreements ---------------------------------------------------
ALTER TABLE "rental_agreements" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- -- vehicles ------------------------------------------------------------
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN DEFAULT TRUE;
-- Backfill: treat any existing vehicle as active. The legacy `status`
-- column (AVAILABLE / RENTED / MAINTENANCE / INACTIVE / SOLD) is the
-- canonical state — is_active is a coarser "is the vehicle in the
-- active fleet?" flag used by the rental availability query.
UPDATE "vehicles" SET "is_active" = TRUE WHERE "is_active" IS NULL;
