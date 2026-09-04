-- Move runtime DDL out of src/app/api/rental/{branches,documents,insurance,transfers}
-- into a real migration. None of the four RAC tables had a tenant_id
-- column despite being wrapped in withTenantRls() — this adds it
-- (nullable) and enables RLS on all four.

CREATE TABLE IF NOT EXISTS rental_branches (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  branch_code      TEXT          UNIQUE NOT NULL,
  branch_name      TEXT          NOT NULL,
  emirate          TEXT          NOT NULL,
  address          TEXT,
  phone            TEXT,
  email            TEXT,
  manager_name     TEXT,
  operating_hours  TEXT          NOT NULL DEFAULT '8:00 AM - 8:00 PM',
  vehicle_capacity INT           NOT NULL DEFAULT 0,
  status           TEXT          NOT NULL DEFAULT 'ACTIVE',
  latitude         NUMERIC(10,7),
  longitude        NUMERIC(10,7),
  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_rb_status ON rental_branches(status);
CREATE INDEX IF NOT EXISTS idx_rb_emirate ON rental_branches(emirate);
ALTER TABLE rental_branches ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS rental_documents (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  doc_ref             TEXT        UNIQUE NOT NULL,
  customer_id         TEXT,
  customer_name       TEXT        NOT NULL,
  doc_type            TEXT        NOT NULL,
  doc_number          TEXT,
  issuing_authority   TEXT,
  issue_date          DATE,
  expiry_date         DATE,
  nationality         TEXT,
  status              TEXT        NOT NULL DEFAULT 'PENDING_VERIFICATION',
  verified_by         TEXT,
  verified_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  file_url            TEXT,
  notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_rdv_status ON rental_documents(status);
CREATE INDEX IF NOT EXISTS idx_rdv_doc_type ON rental_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_rdv_expiry ON rental_documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_rdv_customer ON rental_documents(customer_id);
ALTER TABLE rental_documents ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS rental_insurance_policies (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  policy_no        TEXT          UNIQUE NOT NULL,
  vehicle_id       TEXT,
  vehicle_no       TEXT          NOT NULL,
  vehicle_name     TEXT,
  insurer          TEXT          NOT NULL,
  policy_type      TEXT          NOT NULL DEFAULT 'COMPREHENSIVE',
  coverage_amount  NUMERIC(15,2),
  excess_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  premium_annual   NUMERIC(10,2),
  start_date       DATE          NOT NULL,
  end_date         DATE          NOT NULL,
  status           TEXT          NOT NULL DEFAULT 'ACTIVE',
  document_url     TEXT,
  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_rip_status ON rental_insurance_policies(status);
CREATE INDEX IF NOT EXISTS idx_rip_vehicle_no ON rental_insurance_policies(vehicle_no);
CREATE INDEX IF NOT EXISTS idx_rip_end_date ON rental_insurance_policies(end_date);
ALTER TABLE rental_insurance_policies ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS rental_vehicle_transfers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
CREATE INDEX IF NOT EXISTS idx_rvt_status ON rental_vehicle_transfers(status);
CREATE INDEX IF NOT EXISTS idx_rvt_from_branch ON rental_vehicle_transfers(from_branch_name);
CREATE INDEX IF NOT EXISTS idx_rvt_to_branch ON rental_vehicle_transfers(to_branch_name);
CREATE INDEX IF NOT EXISTS idx_rvt_transfer_date ON rental_vehicle_transfers(transfer_date);
ALTER TABLE rental_vehicle_transfers ADD COLUMN IF NOT EXISTS tenant_id TEXT;

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'rental_branches'],
    ARRAY['public', 'rental_documents'],
    ARRAY['public', 'rental_insurance_policies'],
    ARRAY['public', 'rental_vehicle_transfers']
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
