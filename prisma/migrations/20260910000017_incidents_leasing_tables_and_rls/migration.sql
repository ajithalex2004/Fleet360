-- Move runtime DDL out of src/app/api/incidents/[id]/notes and the leasing
-- trio (amendments, handover, transfers) into a real migration.
--
-- The leasing trio's ensureTable() already ran an ALTER+backfill on every
-- request in production, assigning any NULL tenant_id row to the oldest
-- active tenant so historical data stays reachable. That backfill is
-- transcribed verbatim here (not new behaviour — just relocated), which is
-- why those three end up with zero NULL tenant_id rows and get SET NOT NULL
-- by the generic RLS block below. incident_notes never had a tenant_id at
-- all and has no reliable attribution path, so it gets a nullable column
-- like the other bare tables in this batch.

CREATE TABLE IF NOT EXISTS incident_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID        NOT NULL,
  note_type   TEXT        NOT NULL DEFAULT 'INVESTIGATION',
  content     TEXT        NOT NULL,
  author      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incident_notes_inc ON incident_notes(incident_id);
ALTER TABLE incident_notes ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS leasing_amendments (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  tenant_id         TEXT,
  amendment_no      TEXT         UNIQUE NOT NULL,
  contract_id       TEXT,
  contract_no       TEXT,
  lessee_name       TEXT         NOT NULL,
  vehicle_no        TEXT,
  vehicle_name      TEXT,
  amendment_type    TEXT         NOT NULL,
  description       TEXT         NOT NULL,
  original_value    TEXT,
  new_value         TEXT,
  financial_impact  NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_impact      NUMERIC(12,2) NOT NULL DEFAULT 0,
  effective_date    DATE,
  status            TEXT         NOT NULL DEFAULT 'DRAFT',
  submitted_by      TEXT,
  submitted_at      TIMESTAMPTZ,
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ,
  rejected_by       TEXT,
  rejected_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  implemented_at    TIMESTAMPTZ,
  notes             TEXT
);
ALTER TABLE leasing_amendments ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE leasing_amendments
   SET tenant_id = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1)
 WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leasing_amendments_tenant ON leasing_amendments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leasing_amendments_status ON leasing_amendments(status);
CREATE INDEX IF NOT EXISTS idx_leasing_amendments_type ON leasing_amendments(amendment_type);
CREATE INDEX IF NOT EXISTS idx_leasing_amendments_contract ON leasing_amendments(contract_no);

CREATE TABLE IF NOT EXISTS leasing_handovers (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  tenant_id          TEXT,
  handover_no        TEXT         UNIQUE NOT NULL,
  contract_id        TEXT,
  contract_no        TEXT,
  lessee_name        TEXT         NOT NULL,
  vehicle_id         TEXT,
  vehicle_no         TEXT         NOT NULL,
  vehicle_name       TEXT,
  handover_type      TEXT         NOT NULL,
  handover_date      TIMESTAMPTZ  NOT NULL,
  location           TEXT,
  fuel_level         INT          CHECK (fuel_level BETWEEN 0 AND 8),
  odometer_reading   INT,
  condition_score    INT          CHECK (condition_score BETWEEN 1 AND 5),
  body_condition     TEXT,
  interior_condition TEXT,
  tyres_condition    TEXT,
  keys_count         INT          NOT NULL DEFAULT 2,
  spare_key          BOOLEAN      NOT NULL DEFAULT FALSE,
  salik_tag          BOOLEAN      NOT NULL DEFAULT FALSE,
  parking_card       BOOLEAN      NOT NULL DEFAULT FALSE,
  service_book       BOOLEAN      NOT NULL DEFAULT FALSE,
  accessories        JSONB        NOT NULL DEFAULT '[]',
  checklist_items    JSONB        NOT NULL DEFAULT '[]',
  damage_notes       TEXT,
  notes              TEXT,
  signed_by          TEXT,
  signed_at          TIMESTAMPTZ,
  witnessed_by       TEXT,
  status             TEXT         NOT NULL DEFAULT 'SCHEDULED',
  branch_id          TEXT
);
ALTER TABLE leasing_handovers ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE leasing_handovers
   SET tenant_id = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1)
 WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leasing_handovers_tenant ON leasing_handovers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leasing_handovers_status ON leasing_handovers(status);
CREATE INDEX IF NOT EXISTS idx_leasing_handovers_type ON leasing_handovers(handover_type);
CREATE INDEX IF NOT EXISTS idx_leasing_handovers_date ON leasing_handovers(handover_date);

CREATE TABLE IF NOT EXISTS leasing_vehicle_transfers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id        TEXT,
  transfer_no      TEXT        UNIQUE NOT NULL,
  vehicle_id       TEXT,
  vehicle_no       TEXT        NOT NULL,
  vehicle_name     TEXT,
  vehicle_make     TEXT,
  vehicle_model    TEXT,
  from_branch_id   TEXT,
  from_branch_name TEXT        NOT NULL,
  from_emirate     TEXT,
  to_branch_id     TEXT,
  to_branch_name   TEXT        NOT NULL,
  to_emirate       TEXT,
  transfer_date    DATE        NOT NULL,
  reason           TEXT        NOT NULL,
  fuel_level       INT         CHECK (fuel_level BETWEEN 0 AND 8),
  odometer_reading INT,
  condition_notes  TEXT,
  driver_name      TEXT,
  driver_phone     TEXT,
  status           TEXT        NOT NULL DEFAULT 'REQUESTED',
  requested_by     TEXT,
  approved_by      TEXT,
  approved_at      TIMESTAMPTZ,
  departed_at      TIMESTAMPTZ,
  arrived_at       TIMESTAMPTZ,
  cancelled_reason TEXT,
  notes            TEXT
);
ALTER TABLE leasing_vehicle_transfers ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE leasing_vehicle_transfers
   SET tenant_id = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1)
 WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_lvt_tenant ON leasing_vehicle_transfers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lvt_status ON leasing_vehicle_transfers(status);
CREATE INDEX IF NOT EXISTS idx_lvt_from_branch ON leasing_vehicle_transfers(from_branch_name);
CREATE INDEX IF NOT EXISTS idx_lvt_to_branch ON leasing_vehicle_transfers(to_branch_name);
CREATE INDEX IF NOT EXISTS idx_lvt_transfer_date ON leasing_vehicle_transfers(transfer_date);

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'incident_notes'],
    ARRAY['public', 'leasing_amendments'],
    ARRAY['public', 'leasing_handovers'],
    ARRAY['public', 'leasing_vehicle_transfers']
  ];
  i int;
  sch text;
  tbl text;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    sch := targets[i][1];
    tbl := targets[i][2];

    IF to_regclass(quote_ident(sch) || '.' || quote_ident(tbl)) IS NULL THEN
      RAISE NOTICE 'SKIP %.% — does not exist', sch, tbl;
      CONTINUE;
    END IF;

    SELECT data_type, is_nullable INTO coltype, nullable
      FROM information_schema.columns
     WHERE table_schema = sch AND table_name = tbl AND column_name = 'tenant_id';

    IF coltype IS NULL THEN
      RAISE NOTICE 'SKIP %.% — no tenant_id column', sch, tbl;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I WHERE tenant_id IS NULL', sch, tbl) INTO nulls;

    IF nullable = 'YES' AND nulls = 0 THEN
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN tenant_id SET NOT NULL', sch, tbl);
    ELSIF nulls > 0 THEN
      RAISE NOTICE '%.% has % NULL-tenant row(s) — column left nullable, rows become platform-only', sch, tbl, nulls;
    END IF;

    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', sch, tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I FOR ALL USING (%s) WITH CHECK (%s)',
      sch, tbl, expr, expr);

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', sch, tbl);

    done := done + 1;
    RAISE NOTICE 'RLS enabled on %.% (tenant_id %, % rows had NULL)', sch, tbl, coltype, nulls;
  END LOOP;

  RAISE NOTICE 'enabled RLS on % of % tables', done, array_length(targets, 1);
END $$;
