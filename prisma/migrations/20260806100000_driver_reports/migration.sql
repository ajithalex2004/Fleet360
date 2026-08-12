-- Migration: driver_reports
-- The driver app can file two kinds of reports against the system:
--
--   REQUEST: a service ask from the driver
--     - MAINTENANCE   (engine warning, brakes feel off, etc.)
--     - RENEWAL       (insurance/registration/document renewal)
--     - WASHING       (vehicle needs a wash)
--     (extensible — add new types to the CHECK + the driver-reports lib)
--
--   INCIDENT: a factual event that happened
--     - ACCIDENT              (traffic accident)
--     - BREAKDOWN             (mechanical failure)
--     - TRAFFIC_DELAY         (significant delay due to traffic)
--     - PASSENGER_COMPLAINT   (passenger issue)
--     (extensible)
--
-- Lifecycle: OPEN → ACK (dispatcher saw it) → IN_PROGRESS → RESOLVED
--                                  or CANCELLED (driver or dispatcher withdraws)
--
-- Severity is for incidents only (LOW / MEDIUM / HIGH / CRITICAL). NULL
-- for requests. Indexed so the dispatcher can sort by severity.
--
-- location is a JSONB blob: {lat, lng, accuracyM} at the moment the
-- report was filed. Optional — driver might file a report offline or
-- before GPS is available.

CREATE TABLE IF NOT EXISTS driver_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  driver_id         UUID NOT NULL,
  trip_id           TEXT,  -- text to match trip_schedules.id; nullable (the report might not be tied to a trip)
  shift_id          UUID,  -- nullable; not all reports happen during a shift
  kind              TEXT NOT NULL CHECK (kind IN ('REQUEST', 'INCIDENT')),
  type              TEXT NOT NULL,  -- see REQUEST_TYPES / INCIDENT_TYPES in src/lib/driver-reports.ts
  severity          TEXT CHECK (severity IS NULL OR severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title             TEXT NOT NULL,  -- short label, e.g. "Engine warning light"
  description       TEXT,           -- longer detail
  location          JSONB,          -- {lat, lng, accuracyM}
  status            TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACK', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED')),
  acknowledged_by   UUID,
  acknowledged_at   TIMESTAMPTZ,
  resolved_by       UUID,
  resolved_at       TIMESTAMPTZ,
  resolution_notes  TEXT,
  cancelled_by      UUID,
  cancelled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Common access patterns: list by driver (newest first), list by tenant+status (for dispatcher)
CREATE INDEX IF NOT EXISTS driver_reports_tenant_driver_idx
  ON driver_reports (tenant_id, driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS driver_reports_tenant_status_idx
  ON driver_reports (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS driver_reports_tenant_kind_idx
  ON driver_reports (tenant_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS driver_reports_tenant_severity_idx
  ON driver_reports (tenant_id, severity, created_at DESC)
  WHERE severity IS NOT NULL;
