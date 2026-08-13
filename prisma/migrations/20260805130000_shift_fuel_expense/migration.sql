-- Migration: 20260805130000_shift_fuel_expense
--
-- Three new tables for the driver mobile app's shift-aware features:
--
--   shifts
--     A driver's working session. The "Shift Checklist" is recorded
--     on this row (JSONB items + signature). Created at login if
--     there isn't an active shift; closed when the driver logs out
--     or the shift ends.
--
--   fuel_entries
--     One row per fuel fill-up. May be tied to a trip (optional) and
--     a shift. Captures liters, cost, odometer, GPS location of the
--     filling station, and an optional bill photo.
--
--   expense_entries
--     One row per trip expense (tolls, parking, meals, fines, etc.).
--     Always tied to a specific trip. Captures amount, currency,
--     category, description, and an optional bill photo.
--
-- Two photo tables for binary bill storage. We mirror the dvir_photos
-- pattern (base64 bytea inline for now; presigned S3 upload is the
-- production target).
--
-- The photo tables are created BEFORE the entry tables because the
-- entry tables FK-reference the photo tables. PostgreSQL doesn't
-- support forward-referencing FKs in CREATE TABLE IF NOT EXISTS.
--
-- Applied via docs/apply_shift_fuel_expense_migration.py.

-- ============================================================
-- Photo tables (created first so entry tables can FK them)
-- ============================================================

CREATE TABLE IF NOT EXISTS fuel_entry_photos (
  id                UUID        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  fuel_entry_id     UUID        NOT NULL,
  mime              TEXT        NOT NULL,
  size              INTEGER     NOT NULL,
  -- Inline base64-encoded blob. First cut; production will use
  -- S3-compatible object storage with a presigned upload flow.
  data              BYTEA       NOT NULL,
  taken_at          TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fuel_entry_photos_entry_idx ON fuel_entry_photos (fuel_entry_id);
CREATE INDEX IF NOT EXISTS fuel_entry_photos_tenant_idx ON fuel_entry_photos (tenant_id);


CREATE TABLE IF NOT EXISTS expense_entry_photos (
  id                UUID        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  expense_entry_id  UUID        NOT NULL,
  mime              TEXT        NOT NULL,
  size              INTEGER     NOT NULL,
  data              BYTEA       NOT NULL,
  taken_at          TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expense_entry_photos_entry_idx ON expense_entry_photos (expense_entry_id);
CREATE INDEX IF NOT EXISTS expense_entry_photos_tenant_idx ON expense_entry_photos (tenant_id);


-- ============================================================
-- Shifts
-- ============================================================

CREATE TABLE IF NOT EXISTS shifts (
  id                UUID        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  driver_id         UUID        NOT NULL,
  vehicle_id        UUID,
  -- Started at login, ended at logout (or shift end). Allows us to
  -- scope fuel / expense / checklist queries by "today's shift".
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  -- Active = "driver is logged in for this shift". Closed = "logged
  -- out / shift ended". Only one row per driver should be ACTIVE at
  -- a time; the API enforces that.
  status            TEXT        NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE', 'CLOSED')),
  -- Shift checklist items (free-form JSONB keyed by checklist key).
  -- Same shape as dvir.items: { key: { ok, note, photoIds } }.
  -- Defaults to NULL — the checklist may or may not be filled out
  -- before the shift starts (the UI gates the rest of the app on
  -- checklist completion).
  checklist         JSONB,
  checklist_signed_at TIMESTAMPTZ,
  -- The signed SVG path from the touch-draw signature pad.
  checklist_signature_svg TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one ACTIVE shift per driver. The API enforces this; the
-- partial unique index is a defence-in-depth constraint.
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_active_per_driver
  ON shifts (driver_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS shifts_tenant_driver_idx ON shifts (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS shifts_tenant_started_idx ON shifts (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS shifts_status_idx ON shifts (tenant_id, status);


-- ============================================================
-- Fuel entries (FK to shifts + fuel_entry_photos)
-- ============================================================

CREATE TABLE IF NOT EXISTS fuel_entries (
  id                UUID        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  shift_id          UUID        REFERENCES shifts(id) ON DELETE SET NULL,
  trip_id           UUID,        -- nullable: a fuel fill may not be tied to a specific trip
  driver_id         UUID        NOT NULL,
  vehicle_id        UUID,
  -- Quantity in liters (decimal to support partial fills).
  liters            NUMERIC(10, 3) NOT NULL CHECK (liters > 0),
  -- Cost in minor currency units (fils for AED, paise for INR).
  -- Storing as integer minor units avoids floating-point rounding.
  cost_minor        BIGINT      NOT NULL CHECK (cost_minor >= 0),
  currency          TEXT        NOT NULL DEFAULT 'AED',
  odometer          INTEGER,
  -- GPS location of the filling station.
  location_lat      NUMERIC(9, 6),
  location_lng      NUMERIC(9, 6),
  -- Human-readable station name (e.g. "ADNOC Al Quoz"). Optional —
  -- reverse-geocoded by the client at capture time when possible.
  location_name     TEXT,
  -- Reference to the bill photo row. The actual bytes live in
  -- fuel_entry_photos — we keep the photo separate so the entry
  -- row stays small and queries stay fast.
  bill_photo_id     UUID        REFERENCES fuel_entry_photos(id) ON DELETE SET NULL,
  filled_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fuel_entries_tenant_shift_idx ON fuel_entries (tenant_id, shift_id);
CREATE INDEX IF NOT EXISTS fuel_entries_tenant_trip_idx  ON fuel_entries (tenant_id, trip_id);
CREATE INDEX IF NOT EXISTS fuel_entries_tenant_driver_idx ON fuel_entries (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS fuel_entries_filled_at_idx   ON fuel_entries (tenant_id, filled_at DESC);


-- ============================================================
-- Expense entries (FK to shifts + expense_entry_photos)
-- ============================================================

CREATE TABLE IF NOT EXISTS expense_entries (
  id                UUID        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  shift_id          UUID        REFERENCES shifts(id) ON DELETE SET NULL,
  trip_id           UUID        NOT NULL,  -- every expense is tied to a trip
  driver_id         UUID        NOT NULL,
  -- TOLLS | PARKING | MEALS | FINES | OTHER (extensible).
  category          TEXT        NOT NULL
                    CHECK (category IN ('TOLLS', 'PARKING', 'MEALS', 'FINES', 'OTHER')),
  -- Minor currency units, same convention as fuel_entries.
  amount_minor      BIGINT      NOT NULL CHECK (amount_minor > 0),
  currency          TEXT        NOT NULL DEFAULT 'AED',
  description       TEXT,
  bill_photo_id     UUID        REFERENCES expense_entry_photos(id) ON DELETE SET NULL,
  incurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expense_entries_tenant_trip_idx ON expense_entries (tenant_id, trip_id);
CREATE INDEX IF NOT EXISTS expense_entries_tenant_shift_idx ON expense_entries (tenant_id, shift_id);
CREATE INDEX IF NOT EXISTS expense_entries_tenant_driver_idx ON expense_entries (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS expense_entries_incurred_at_idx ON expense_entries (tenant_id, incurred_at DESC);


-- ============================================================
-- Now wire the photo → entry FKs (couldn't do this in the CREATE
-- TABLE because the entry tables didn't exist yet at that point).
-- ============================================================

ALTER TABLE fuel_entry_photos
  DROP CONSTRAINT IF EXISTS fuel_entry_photos_fuel_entry_fk;
ALTER TABLE fuel_entry_photos
  ADD CONSTRAINT fuel_entry_photos_fuel_entry_fk
  FOREIGN KEY (fuel_entry_id) REFERENCES fuel_entries(id) ON DELETE CASCADE;

ALTER TABLE expense_entry_photos
  DROP CONSTRAINT IF EXISTS expense_entry_photos_expense_entry_fk;
ALTER TABLE expense_entry_photos
  ADD CONSTRAINT expense_entry_photos_expense_entry_fk
  FOREIGN KEY (expense_entry_id) REFERENCES expense_entries(id) ON DELETE CASCADE;
