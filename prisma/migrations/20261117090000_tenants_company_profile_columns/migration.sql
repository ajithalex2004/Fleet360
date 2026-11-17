-- Company-profile / UAE e-invoicing (PEPPOL) columns on public.tenants.
--
-- src/app/api/admin/company-profile/route.ts used to add these with ALTER
-- TABLE at request time (ensureColumns), swallowing the error when the
-- runtime role lacked DDL rights. That tripped the runtime-DDL guard
-- (scripts/check-no-runtime-ddl.mjs) and left a database built from
-- migrations alone without the columns the route reads and writes. Moved here
-- verbatim, defaults included.
--
-- IF NOT EXISTS: a no-op where the request-time ALTER already ran.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "trn" TEXT,
  ADD COLUMN IF NOT EXISTS "corporate_tax_trn" TEXT,
  ADD COLUMN IF NOT EXISTS "trade_license_no" TEXT,
  ADD COLUMN IF NOT EXISTS "trade_license_authority" TEXT,
  ADD COLUMN IF NOT EXISTS "peppol_endpoint_id" TEXT,
  ADD COLUMN IF NOT EXISTS "peppol_scheme_id" TEXT DEFAULT '0235',
  ADD COLUMN IF NOT EXISTS "arabic_name" TEXT,
  ADD COLUMN IF NOT EXISTS "street_name" TEXT,
  ADD COLUMN IF NOT EXISTS "additional_street_name" TEXT,
  ADD COLUMN IF NOT EXISTS "postal_zone" TEXT,
  ADD COLUMN IF NOT EXISTS "emirate" TEXT,
  ADD COLUMN IF NOT EXISTS "emirate_code" TEXT,
  ADD COLUMN IF NOT EXISTS "country_code" TEXT DEFAULT 'AE',
  ADD COLUMN IF NOT EXISTS "tax_scheme_id" TEXT DEFAULT 'VAT';
