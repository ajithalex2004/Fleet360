-- Migration: 20260805110000_dvir_tables
--
-- Two tables for the driver mobile app's DVIR (Driver Vehicle
-- Inspection Report) feature:
--   - dvir       — the inspection itself, with the checklist items
--                  and any defects
--   - dvir_photos — defect photos (the base64 inline path; production
--                   will switch to S3-compatible object storage)
--
-- The driver mobile app writes the DVIR offline, queues it in the
-- sync queue, and the API endpoint is the dequeue target. The DVIR
-- has a client-generated UUID so submissions are idempotent: a
-- duplicate sync after the queue already drained is a no-op.
--
-- Status:
--   PASS    — no critical defects, vehicle is fit for the trip
--   FAIL    — minor / major defects, driver may proceed with notes
--   BLOCKED — critical defect, vehicle must be taken out of service
--             until repaired. The system auto-disables the vehicle's
--             assignment to upcoming trips.
--
-- The BLOCKED-state side-effect (auto-disable vehicle) is implemented
-- in the API route via a follow-up update to the trip_schedules row
-- (mark vehicle as unavailable for future trips). Not in this
-- migration — see the route handler.
--
-- Applied via docs/apply_dvir_migration.py.

CREATE TABLE IF NOT EXISTS dvir (
  id              UUID        PRIMARY KEY,
  tenant_id       UUID        NOT NULL,
  trip_id         UUID        NOT NULL,
  driver_id       UUID        NOT NULL,
  vehicle_id      UUID,
  type            TEXT        NOT NULL CHECK (type IN ('PRE_TRIP', 'POST_TRIP')),
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  odometer_start  INTEGER,
  odometer_end    INTEGER,
  -- items: { "brakes": { "ok": true, "note": "..." }, "tyres": { ... } }
  -- Free-form keys per the per-tenant checklist configuration. The
  -- server validates that every key is in the tenant's active
  -- checklist (or accepts the legacy PRE_TRIP / POST_TRIP defaults).
  items           JSONB       NOT NULL,
  -- defects: array of { category, description, severity, photoIds }
  -- Mirrors the OfflineDvirDefect type in src/lib/driver-offline/db.ts.
  defects         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  notes           TEXT,
  signature_svg   TEXT,
  status          TEXT        NOT NULL DEFAULT 'PASS'
                  CHECK (status IN ('PASS', 'FAIL', 'BLOCKED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dvir_tenant_driver_idx ON dvir (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS dvir_tenant_trip_idx   ON dvir (tenant_id, trip_id);
CREATE INDEX IF NOT EXISTS dvir_tenant_vehicle_idx ON dvir (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS dvir_status_idx        ON dvir (tenant_id, status);

CREATE TABLE IF NOT EXISTS dvir_photos (
  id              UUID        PRIMARY KEY,
  dvir_id         UUID        NOT NULL REFERENCES dvir(id) ON DELETE CASCADE,
  tenant_id       UUID        NOT NULL,
  mime            TEXT        NOT NULL,
  size            INTEGER     NOT NULL,
  -- Inline base64-encoded blob. The first cut; production will use
  -- S3-compatible object storage with a presigned upload flow on the
  -- client. The bytea column is fine for the dev/test path and small
  -- defect photos (<1 MB each).
  data            BYTEA       NOT NULL,
  taken_at        TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dvir_photos_dvir_idx ON dvir_photos (dvir_id);
CREATE INDEX IF NOT EXISTS dvir_photos_tenant_idx ON dvir_photos (tenant_id);
