-- Master catalogue of ancillary products that can be attached to RAC bookings.
CREATE TABLE IF NOT EXISTS "rental_ancillaries" (
  "id"                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"             TIMESTAMPTZ  DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ,
  "deleted_at"             TIMESTAMPTZ,
  "code"                   TEXT         NOT NULL UNIQUE,
  "name_en"                TEXT         NOT NULL,
  "name_ar"                TEXT,
  "description"            TEXT,
  "category"               TEXT,
  "pricing_type"           TEXT         NOT NULL,
  "unit_price"             DECIMAL      NOT NULL,
  "currency"               TEXT         DEFAULT 'AED',
  "applicable_categories"  TEXT,
  "is_active"              BOOLEAN      DEFAULT TRUE,
  "sort_order"             INT          DEFAULT 0,
  "notes"                  TEXT
);

CREATE INDEX IF NOT EXISTS "idx_rental_ancillaries_deleted_at" ON "rental_ancillaries" ("deleted_at");
