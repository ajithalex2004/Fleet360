-- Extend tenants table with domain, address, language and booking configuration fields

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "domain"               TEXT,
  ADD COLUMN IF NOT EXISTS "address"              TEXT,
  ADD COLUMN IF NOT EXISTS "default_language"     TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "supported_languages"  TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "localized_name"       TEXT,
  ADD COLUMN IF NOT EXISTS "localized_desc"       TEXT,
  ADD COLUMN IF NOT EXISTS "booking_types"        TEXT;
