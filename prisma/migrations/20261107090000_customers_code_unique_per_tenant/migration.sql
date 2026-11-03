-- customer_code unique per tenant, not across the platform.
--
-- 9b11589e made POST /api/customers run this DDL on every create (inside a
-- savepoint, errors swallowed). The runtime role cannot run DDL, so in
-- production it never took effect and two tenants still cannot use the same
-- customer code. Moved here; the route no longer runs it.
--
-- The global constraint has kept codes unique platform-wide, so they are
-- unique per tenant too and the new index always builds. Safe to re-run.
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_customer_code_key;
DROP INDEX IF EXISTS public.customers_customer_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_customer_code
  ON public.customers (tenant_id, customer_code)
  WHERE customer_code IS NOT NULL;
