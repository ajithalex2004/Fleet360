-- Yield-management event calendar for the RAC pricing engine.
-- Used to layer holiday / festival / event surcharges (or discounts)
-- on top of the base rate calculation.

CREATE TABLE IF NOT EXISTS "rate_events" (
  "id"                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"             TIMESTAMPTZ  DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ,
  "deleted_at"             TIMESTAMPTZ,
  "event_code"             TEXT         NOT NULL UNIQUE,   -- DSF | EID_FITR | EID_ADHA | F1 | NYE | SUMMER_LOW | CUSTOM
  "name"                   TEXT         NOT NULL,
  "description"            TEXT,
  "date_from"              TIMESTAMPTZ  NOT NULL,
  "date_to"                TIMESTAMPTZ  NOT NULL,
  "multiplier"             DECIMAL      NOT NULL,           -- 1.25 = +25%, 0.85 = -15%
  "applicable_categories"  TEXT,                            -- CSV of vehicle categories or NULL = all
  "applicable_channels"    TEXT,                            -- CSV of channels or NULL = all
  "priority"               INT          DEFAULT 0,          -- higher wins when ranges overlap
  "is_active"              BOOLEAN      DEFAULT TRUE,
  "notes"                  TEXT
);

CREATE INDEX IF NOT EXISTS "idx_rate_events_active_dates" ON "rate_events" ("is_active", "date_from", "date_to");
CREATE INDEX IF NOT EXISTS "idx_rate_events_deleted_at" ON "rate_events" ("deleted_at");
