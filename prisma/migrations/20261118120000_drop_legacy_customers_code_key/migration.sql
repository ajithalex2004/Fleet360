-- Drop legacy global unique index on public.customers(customer_code).
-- 20261107090000_customers_code_unique_per_tenant targeted customers_customer_code_key,
-- whereas 20260414000006_customer_management created customers_code_key (standalone index).
DROP INDEX IF EXISTS public.customers_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_customer_code
  ON public.customers (tenant_id, customer_code)
  WHERE customer_code IS NOT NULL;
