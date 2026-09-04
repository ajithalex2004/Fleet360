-- Move runtime DDL out of src/app/api/finance/{deposits,recurring-invoices}
-- into a real migration. Neither table had a tenant_id column despite
-- being wrapped in withTenantRls() — this adds it (nullable) and enables
-- RLS on all three tables.

CREATE TABLE IF NOT EXISTS finance_security_deposits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_no       TEXT UNIQUE NOT NULL,
  contract_id      TEXT NOT NULL,
  contract_type    TEXT NOT NULL DEFAULT 'LEASE',
  customer_name    TEXT NOT NULL,
  customer_trn     TEXT,
  vehicle_no       TEXT NOT NULL,
  vehicle_type     TEXT,
  branch           TEXT NOT NULL DEFAULT 'Dubai',
  collected_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  collection_date  DATE NOT NULL,
  collection_method TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  cheque_no        TEXT,
  bank_name        TEXT,
  status           TEXT NOT NULL DEFAULT 'HELD',
  deductions       JSONB NOT NULL DEFAULT '[]',
  total_deducted   NUMERIC(14,2) NOT NULL DEFAULT 0,
  refund_amount    NUMERIC(14,2),
  refund_date      DATE,
  refund_method    TEXT,
  refund_reference TEXT,
  held_days        INTEGER GENERATED ALWAYS AS (
    CASE WHEN refund_date IS NOT NULL
      THEN (refund_date - collection_date)
      ELSE (CURRENT_DATE - collection_date)
    END
  ) STORED,
  forfeiture_reason TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fsd_contract ON finance_security_deposits(contract_id);
CREATE INDEX IF NOT EXISTS idx_fsd_status   ON finance_security_deposits(status);
CREATE INDEX IF NOT EXISTS idx_fsd_branch   ON finance_security_deposits(branch);
ALTER TABLE finance_security_deposits ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS finance_recurring_schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_no      TEXT UNIQUE NOT NULL,
  contract_id      TEXT NOT NULL,
  contract_type    TEXT NOT NULL DEFAULT 'LEASE',
  customer_name    TEXT NOT NULL,
  customer_trn     TEXT,
  vehicle_no       TEXT NOT NULL,
  branch           TEXT NOT NULL DEFAULT 'Dubai',
  billing_cycle    TEXT NOT NULL DEFAULT 'MONTHLY',
  amount           NUMERIC(14,2) NOT NULL,
  vat_rate         NUMERIC(5,2)  NOT NULL DEFAULT 5,
  vat_amount       NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(amount * vat_rate / 100, 2)) STORED,
  grand_total      NUMERIC(14,2) GENERATED ALWAYS AS (amount + ROUND(amount * vat_rate / 100, 2)) STORED,
  start_date       DATE NOT NULL,
  end_date         DATE,
  next_invoice_date DATE NOT NULL,
  last_invoice_date DATE,
  invoices_generated INTEGER NOT NULL DEFAULT 0,
  auto_approve     BOOLEAN NOT NULL DEFAULT FALSE,
  status           TEXT NOT NULL DEFAULT 'ACTIVE',
  description      TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE finance_recurring_schedules ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS finance_recurring_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     UUID NOT NULL REFERENCES finance_recurring_schedules(id) ON DELETE CASCADE,
  invoice_id      TEXT,
  invoice_no      TEXT,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  amount          NUMERIC(14,2) NOT NULL,
  vat_amount      NUMERIC(14,2) NOT NULL,
  grand_total     NUMERIC(14,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'DRAFT',
  triggered_by    TEXT NOT NULL DEFAULT 'MANUAL',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE finance_recurring_log ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_frs_next_date ON finance_recurring_schedules(next_invoice_date);
CREATE INDEX IF NOT EXISTS idx_frs_status    ON finance_recurring_schedules(status);
CREATE INDEX IF NOT EXISTS idx_frl_schedule  ON finance_recurring_log(schedule_id);

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'finance_security_deposits'],
    ARRAY['public', 'finance_recurring_schedules'],
    ARRAY['public', 'finance_recurring_log']
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
