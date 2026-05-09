-- Pre-trip safety checks logged by the driver before each TripSchedule
-- DEPARTED transition. UAE RTA requires evidence of vehicle inspection
-- before passenger pickup; this is the digital trail.
CREATE TABLE IF NOT EXISTS "bus_pretrip_checks" (
  "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"      TIMESTAMPTZ  DEFAULT NOW(),
  "schedule_id"     UUID         NOT NULL,
  "vehicle_id"      UUID,
  "driver_id"       TEXT,
  "performed_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "performed_by"    TEXT,
  -- JSON array: [{ item: string, ok: boolean, note?: string }]
  "check_items"     JSONB        NOT NULL,
  "overall_pass"    BOOLEAN      NOT NULL DEFAULT TRUE,
  "fail_count"      INT          NOT NULL DEFAULT 0,
  "notes"           TEXT,
  "signature_data"  TEXT
);

CREATE INDEX IF NOT EXISTS "idx_bus_pretrip_checks_schedule_id"
  ON "bus_pretrip_checks" ("schedule_id");
CREATE INDEX IF NOT EXISTS "idx_bus_pretrip_checks_performed_at"
  ON "bus_pretrip_checks" ("performed_at");
