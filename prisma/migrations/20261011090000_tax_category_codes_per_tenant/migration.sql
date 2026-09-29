-- Tax category codes unique per tenant.
-- finance_tax_categories holds the shared UAE VAT categories (tenant_id
-- NULL) and each tenant's own categories. Its code was unique across the
-- whole table, so a tenant could not use a code another tenant had, nor
-- keep its own version of a shared code: the save updated the other row,
-- which row level security refused. Codes are now unique per tenant, and
-- unique among the shared categories. One statement per line, so the Neon
-- SQL Editor runs it as written; idempotent.

ALTER TABLE IF EXISTS finance.finance_tax_categories DROP CONSTRAINT IF EXISTS finance_tax_categories_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS finance_tax_categories_tenant_code_key ON finance.finance_tax_categories (tenant_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS finance_tax_categories_shared_code_key ON finance.finance_tax_categories (code) WHERE tenant_id IS NULL;
