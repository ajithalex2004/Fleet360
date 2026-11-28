-- Dynamic Transport Catalogue: custom categories, per-section custom fields,
-- default field values, Booking Portal visibility, and dynamic module mapping.
--
-- Additive only: widens the static 8-category CHECK constraints to accept
-- tenant-defined uppercase codes (^[A-Z][A-Z0-9_]{1,47}$) and adds metadata +
-- custom_form_config JSONB columns to tenant_transport_categories.

-- 1. Widen category CHECK constraints to allow tenant-defined custom categories.
ALTER TABLE tenant_transport_categories
  DROP CONSTRAINT IF EXISTS tenant_transport_categories_category_check;
ALTER TABLE tenant_transport_categories
  ADD CONSTRAINT tenant_transport_categories_category_check
  CHECK (category ~ '^[A-Z][A-Z0-9_]{1,47}$');

ALTER TABLE customer_portal_access
  DROP CONSTRAINT IF EXISTS customer_portal_access_categories_check;
ALTER TABLE customer_portal_access
  ADD CONSTRAINT customer_portal_access_categories_check
  CHECK (array_position(categories, '') IS NULL);

ALTER TABLE customer_transport_requests
  DROP CONSTRAINT IF EXISTS customer_transport_requests_category_check;
ALTER TABLE customer_transport_requests
  ADD CONSTRAINT customer_transport_requests_category_check
  CHECK (category ~ '^[A-Z][A-Z0-9_]{1,47}$');

-- 2. Extend tenant_transport_categories for custom categories, dynamic module
--    mapping (SERVICE_MODULE_MAP), Booking Portal visibility, and custom form
--    sections/fields.
ALTER TABLE tenant_transport_categories
  ADD COLUMN IF NOT EXISTS is_custom              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS title                  TEXT,
  ADD COLUMN IF NOT EXISTS description            TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_usage          TEXT,
  ADD COLUMN IF NOT EXISTS icon                   TEXT,
  ADD COLUMN IF NOT EXISTS badge                  TEXT,
  ADD COLUMN IF NOT EXISTS accent                 TEXT,
  ADD COLUMN IF NOT EXISTS module_key             TEXT,
  ADD COLUMN IF NOT EXISTS booking_portal_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS sort_order             INT     NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS custom_form_config     JSONB   NOT NULL DEFAULT '{}'::jsonb;
