-- Migration: 20260812100000_data_model_evolution
-- Adds: TransportRequest, TransportCalendar, extends BoardingEvent + TripPassenger
-- Note: all tables use @@schema("public") — consistent with all existing bus-ops models.

-- ── 1. New enum types ──────────────────────────────────────────────────────────

CREATE TYPE "TransportRequestType" AS ENUM (
  'NEW_ENROLLMENT',
  'ROUTE_CHANGE',
  'STOP_CHANGE',
  'TEMP_TRIP',
  'SPECIAL'
);

CREATE TYPE "TransportRequestStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'FULFILLED'
);

CREATE TYPE "TransportDayType" AS ENUM (
  'NORMAL',
  'PUBLIC_HOLIDAY',
  'COMPANY_HOLIDAY',
  'RAMADAN',
  'WEEKEND',
  'EMERGENCY'
);

CREATE TYPE "BoardingEventType" AS ENUM (
  'BOARDED',
  'ALIGHTED',
  'NO_SHOW'
);

CREATE TYPE "BoardingSource" AS ENUM (
  'BLE',
  'RFID',
  'QR',
  'DRIVER',
  'MANUAL',
  'DISPATCHER'
);

CREATE TYPE "TripPassengerStatus" AS ENUM (
  'CONFIRMED',
  'ABSENT',
  'BOARDED',
  'ALIGHTED',
  'NO_SHOW',
  'CANCELLED',
  'WAITLISTED'
);

-- ── 2. New table: transport_requests ──────────────────────────────────────────

CREATE TABLE transport_requests (
  id           TEXT                     NOT NULL PRIMARY KEY,
  created_at   TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  tenant_id    TEXT                     NOT NULL,
  request_no   TEXT                     NOT NULL,
  request_type "TransportRequestType"   NOT NULL,
  status       "TransportRequestStatus" NOT NULL DEFAULT 'PENDING',
  employee_id  TEXT,
  route_id     TEXT,
  notes        TEXT,
  requested_by TEXT                     NOT NULL,
  approved_by  TEXT,
  approved_at  TIMESTAMPTZ,
  CONSTRAINT transport_requests_request_no_key UNIQUE (request_no)
);

CREATE INDEX idx_transport_requests_tenant_id ON transport_requests (tenant_id);
CREATE INDEX idx_transport_requests_status    ON transport_requests (status);
CREATE INDEX idx_transport_requests_type      ON transport_requests (request_type);

-- ── 3. New table: transport_calendar ──────────────────────────────────────────

CREATE TABLE transport_calendar (
  id         TEXT                NOT NULL PRIMARY KEY,
  created_at TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  tenant_id  TEXT                NOT NULL,
  date       DATE                NOT NULL,
  type       "TransportDayType"  NOT NULL,
  name       TEXT,
  notes      TEXT,
  CONSTRAINT uniq_transport_calendar_tenant_date UNIQUE (tenant_id, date)
);

CREATE INDEX idx_transport_calendar_tenant_date ON transport_calendar (tenant_id, date);
CREATE INDEX idx_transport_calendar_tenant_type ON transport_calendar (tenant_id, type);

-- ── 4. Extend trip_passengers: migrate status column to TripPassengerStatus ───
--
-- All existing values (CONFIRMED, BOARDED, ABSENT, NO_SHOW) are valid members
-- of the new enum. NULL rows and blank strings are coerced to 'CONFIRMED'.
-- The USING expression handles every case without a scan failure.

ALTER TABLE trip_passengers
  ALTER COLUMN status TYPE "TripPassengerStatus"
    USING CASE
      WHEN status IS NULL OR status = '' THEN 'CONFIRMED'::"TripPassengerStatus"
      ELSE status::"TripPassengerStatus"
    END,
  ALTER COLUMN status SET DEFAULT 'CONFIRMED';

-- ── 5. Extend boarding_events: add typed enum + BLE confidence fields ─────────
--
-- Additive only — existing method/direction string columns are preserved so
-- that gateway/events/route.ts and any other writers need no immediate update.
-- New writers should prefer eventType + source; old columns will be deprecated
-- once all callers are migrated.

ALTER TABLE boarding_events
  ADD COLUMN IF NOT EXISTS event_type "BoardingEventType",
  ADD COLUMN IF NOT EXISTS source     "BoardingSource",
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS device_id  TEXT;
