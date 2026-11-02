-- fleet_nui_reasons (vehicle Not-In-Use reason codes) was added in f55d2deb
-- with only runtime DDL in src/lib/fleet/schema.ts, which production skips.
-- The fleet schema registry requires it, so a database built from migrations
-- alone reports /api/readyz as not ready. Same shape as the runtime DDL;
-- a no-op where the table already exists.
CREATE TABLE IF NOT EXISTS fleet_nui_reasons (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  reason_type   TEXT        NOT NULL,
  description   TEXT,
  impact_level  TEXT        DEFAULT 'MEDIUM',
  is_billable   BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fnr_code   ON fleet_nui_reasons(code);
CREATE INDEX IF NOT EXISTS idx_fnr_type   ON fleet_nui_reasons(reason_type);
CREATE INDEX IF NOT EXISTS idx_fnr_active ON fleet_nui_reasons(is_active);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_nui_reasons TO fleet360_app;
  END IF;
END $$;
