-- Shipper onboarding status on customers (Logistics > Shippers).
--
-- Production already has these columns (created outside the migration
-- history); a database built from migrations did not, so the Shippers screen
-- (src/lib/logistics/domain.ts listShipperOnboarding) could not work there.
-- Idempotent: a no-op where the columns exist.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS logistics_onboarding_status TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS logistics_compliance_status TEXT NOT NULL DEFAULT 'PENDING';

CREATE INDEX IF NOT EXISTS idx_customers_tenant_logistics_onboarding
  ON customers (tenant_id, logistics_onboarding_status)
  WHERE deleted_at IS NULL;
