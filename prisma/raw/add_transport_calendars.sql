-- Task 2 — TransportCalendar
--
-- Adds a per-tenant calendar of exception days that the schedule-template
-- generator consults when materialising TripSchedule rows. Kinds:
--   HOLIDAY          — no trip generated for that date (default skip)
--   WORKING_OVERRIDE — force-generate even if activeDays doesn't include
--                      the day-of-week (e.g. weekend work day)
--   HALF_DAY         — informational for now; UI can render specially
--   REDUCED_SERVICE  — informational for now
--
-- Kept minimal: header + entries. Coverage rules (which templates the
-- calendar applies to) are implicit "one active calendar per tenant"
-- for MVP. Multi-calendar / per-template binding is a Phase-2 extension.

CREATE TABLE IF NOT EXISTS transport_calendars (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  tenant_id      TEXT        NOT NULL,
  name           TEXT        NOT NULL,
  effective_from DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_by     TEXT
);
CREATE INDEX IF NOT EXISTS idx_transport_calendars_tenant  ON transport_calendars (tenant_id);
CREATE INDEX IF NOT EXISTS idx_transport_calendars_active  ON transport_calendars (is_active);
CREATE INDEX IF NOT EXISTS idx_transport_calendars_deleted ON transport_calendars (deleted_at);

CREATE TABLE IF NOT EXISTS transport_calendar_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  calendar_id  UUID        NOT NULL REFERENCES transport_calendars(id) ON DELETE CASCADE,
  entry_date   DATE        NOT NULL,
  kind         TEXT        NOT NULL,   -- HOLIDAY | WORKING_OVERRIDE | HALF_DAY | REDUCED_SERVICE
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_transport_calendar_entries_calendar ON transport_calendar_entries (calendar_id);
CREATE INDEX IF NOT EXISTS idx_transport_calendar_entries_date     ON transport_calendar_entries (entry_date);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transport_calendar_entries_cal_date
  ON transport_calendar_entries (calendar_id, entry_date);
