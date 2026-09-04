-- Move runtime DDL out of src/app/api/logistics/{quotes,shipments/[id]/manifest}
-- into a real migration. logistics_shipment_manifest_stops already carries
-- a proper tenant_id; logistics_quotes never had one despite being wrapped
-- in withTenantRls() — this adds it (nullable) and enables RLS on both.

CREATE TABLE IF NOT EXISTS logistics_quotes (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  quote_no        TEXT NOT NULL UNIQUE,
  customer_name   TEXT,
  customer_email  TEXT,
  customer_phone  TEXT,
  origin          TEXT,
  destination     TEXT,
  distance_km     NUMERIC,
  weight_tonnes   NUMERIC,
  shipment_type   TEXT,
  vehicle_type    TEXT,
  cargo_desc      TEXT,
  cargo_value_aed NUMERIC DEFAULT 0,
  is_urgent       BOOLEAN DEFAULT FALSE,
  is_hazmat       BOOLEAN DEFAULT FALSE,
  requires_insurance BOOLEAN DEFAULT FALSE,
  requires_customs   BOOLEAN DEFAULT FALSE,
  base_freight    NUMERIC,
  fuel_surcharge  NUMERIC,
  urgency_surch   NUMERIC DEFAULT 0,
  hazmat_surch    NUMERIC DEFAULT 0,
  insurance_fee   NUMERIC DEFAULT 0,
  customs_fee     NUMERIC DEFAULT 0,
  total_aed       NUMERIC,
  status          TEXT DEFAULT 'DRAFT',
  valid_days      INT DEFAULT 7,
  booking_id      TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE logistics_quotes ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS logistics_shipment_manifest_stops (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  stop_number INT NOT NULL DEFAULT 1,
  stop_name TEXT,
  stop_address TEXT,
  recipient TEXT,
  recipient_phone TEXT,
  cargo_items JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING',
  delivered_at TIMESTAMPTZ,
  delivery_note TEXT,
  signature_b64 TEXT,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_manifest_stops
  ON logistics_shipment_manifest_stops (tenant_id, shipment_order_id, stop_number);

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'logistics_quotes'],
    ARRAY['public', 'logistics_shipment_manifest_stops']
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
