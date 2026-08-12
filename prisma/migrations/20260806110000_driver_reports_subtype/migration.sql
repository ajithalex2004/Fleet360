-- Migration: driver_reports — add subtype column
--
-- Drivers can now file requests with a sub-type (e.g. MAINTENANCE
-- → PREVENTIVE / CORRECTIVE / SCHEDULED / BREAKDOWN_ACCIDENT).
-- Sub-type is optional but strongly encouraged — the dispatcher
-- uses it to route work (e.g. PREVENTIVE → maintenance planner,
-- INSURANCE → fleet admin).
--
-- INCIDENT reports don't have sub-types (their granularity is
-- already in the type field). For incident reports, subtype is
-- always NULL. The form is responsible for not showing the
-- sub-type picker for incidents.

ALTER TABLE driver_reports
  ADD COLUMN IF NOT EXISTS subtype TEXT;

-- Soft guardrail: a sub-type can only be set on REQUEST reports.
-- INCIDENT reports must have subtype = NULL. This is enforced at
-- the application layer (the API rejects subtype on INCIDENT) and
-- here as a CHECK for safety. The catalogue is enforced by the
-- app — we don't enumerate the full list at the DB level so we
-- can add new sub-types without a migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'driver_reports_subtype_kind_check'
  ) THEN
    ALTER TABLE driver_reports
      ADD CONSTRAINT driver_reports_subtype_kind_check
      CHECK (
        (kind = 'REQUEST' AND subtype IS NULL)
        OR (kind = 'REQUEST' AND subtype IS NOT NULL)
        OR (kind = 'INCIDENT' AND subtype IS NULL)
      );
  END IF;
END
$$;

-- Index for "show me all open INSURANCE renewals" style queries.
CREATE INDEX IF NOT EXISTS driver_reports_tenant_subtype_idx
  ON driver_reports (tenant_id, subtype, created_at DESC)
  WHERE subtype IS NOT NULL;
