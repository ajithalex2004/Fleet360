-- Move runtime DDL out of src/app/api/{ambulance/calls,branch-staff,esign/send}
-- and the 3 duplicate carrier-portal/logistics shipment-documents routes,
-- into a real migration. None of these tables had a tenant_id column at
-- all despite being wrapped in withTenantRls() — this adds it (nullable,
-- since existing rows have no reliable attribution path) and enables RLS.
-- Existing untagged rows become platform-admin-only after this runs
-- (strictly safer than today, where the table has no RLS at all).

CREATE TABLE IF NOT EXISTS ambulance_calls (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  call_no         TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'CALL_RECEIVED',
  priority        TEXT        NOT NULL DEFAULT 'MEDIUM',
  caller_name     TEXT,
  caller_phone    TEXT,
  patient_name    TEXT,
  patient_age     INT,
  patient_gender  TEXT,
  chief_complaint TEXT,
  pickup_location TEXT        NOT NULL,
  destination     TEXT,
  vehicle_id      UUID        REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id       UUID,
  paramedic_name  TEXT,
  call_received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at      TIMESTAMPTZ,
  on_scene_at        TIMESTAMPTZ,
  transport_start_at TIMESTAMPTZ,
  at_hospital_at     TIMESTAMPTZ,
  cleared_at         TIMESTAMPTZ,
  response_time_min  INT,
  scene_time_min     INT,
  transport_time_min INT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_amb_calls_status ON ambulance_calls(status);
CREATE INDEX IF NOT EXISTS idx_amb_calls_date ON ambulance_calls(call_received_at);
ALTER TABLE ambulance_calls ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS branch_staff_assignments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  staff_no     TEXT        UNIQUE NOT NULL,
  full_name    TEXT        NOT NULL,
  email        TEXT,
  phone        TEXT        NOT NULL,
  role         TEXT        NOT NULL,
  module       TEXT        NOT NULL,
  branch_id    TEXT,
  branch_name  TEXT        NOT NULL,
  emirate      TEXT,
  start_date   DATE        NOT NULL,
  end_date     DATE,
  status       TEXT        NOT NULL DEFAULT 'ACTIVE',
  employee_id  TEXT,
  nationality  TEXT,
  notes        TEXT
);
ALTER TABLE branch_staff_assignments ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS esign_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signing_token    TEXT        UNIQUE NOT NULL,
  contract_id      TEXT        NOT NULL,
  contract_type    TEXT        NOT NULL,
  contract_ref     TEXT        NOT NULL,
  document_title   TEXT        NOT NULL,
  signer_name      TEXT        NOT NULL,
  signer_email     TEXT,
  signer_phone     TEXT        NOT NULL,
  otp_code         TEXT        NOT NULL,
  otp_expires_at   TIMESTAMPTZ NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'PENDING',
  signed_at        TIMESTAMPTZ,
  signer_ip        TEXT,
  signer_user_agent TEXT,
  sent_via         TEXT        NOT NULL DEFAULT 'SMS',
  resend_count     INT         NOT NULL DEFAULT 0,
  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_esign_signing_token ON esign_requests(signing_token);
CREATE INDEX IF NOT EXISTS idx_esign_contract_id ON esign_requests(contract_id);
CREATE INDEX IF NOT EXISTS idx_esign_status ON esign_requests(status);
ALTER TABLE esign_requests ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Defined identically by 3 routes (carrier-portal app/loads/[id]/documents,
-- logistics/shipments/[id]/documents, logistics/shipments/[id]/documents/[docId]);
-- already carries a proper tenant_id NOT NULL populated on every insert.
CREATE TABLE IF NOT EXISTS logistics_shipment_documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  file_url TEXT,
  file_data TEXT,
  mime_type TEXT,
  file_size BIGINT,
  uploaded_by TEXT,
  notes TEXT,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_docs_shipment
  ON logistics_shipment_documents (tenant_id, shipment_order_id, created_at DESC);

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'ambulance_calls'],
    ARRAY['public', 'branch_staff_assignments'],
    ARRAY['public', 'esign_requests'],
    ARRAY['public', 'logistics_shipment_documents']
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
