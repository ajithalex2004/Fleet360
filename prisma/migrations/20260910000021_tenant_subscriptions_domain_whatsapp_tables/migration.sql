-- Move runtime DDL out of src/app/api/{tenant-subscriptions,tenants/pre-verify-domain,whatsapp/templates}
-- into a real migration.
--
-- tenant_module_subscriptions already carries a proper tenant_id NOT NULL
-- and gets RLS below.
--
-- domain_pre_verifications is a deliberately public, pre-registration
-- table (no auth, no tenant context exists yet at that point in the
-- signup flow) — no tenant_id, no RLS, by design.
--
-- whatsapp_templates is a shared message-template catalog: template_name
-- is globally unique, the one-time seed of 5 default templates runs
-- against the whole table (not per-tenant), and none of GET/POST/PATCH in
-- that route take or filter by a tenant id anywhere in their SQL. That is
-- an existing design choice (one shared template library), not an
-- oversight to correct here — left as a global table like
-- platform_settings, not retrofitted with tenant_id/RLS.

CREATE TABLE IF NOT EXISTS tenant_module_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  tenant_id         TEXT NOT NULL,
  module_code       TEXT NOT NULL,
  plan_tier         TEXT DEFAULT 'STANDARD',
  billing_cycle     TEXT DEFAULT 'MONTHLY',
  base_price        NUMERIC(10,2) NOT NULL,
  currency          TEXT DEFAULT 'AED',
  max_vehicles      INTEGER DEFAULT 50,
  max_users         INTEGER DEFAULT 5,
  max_students      INTEGER DEFAULT 0,
  setup_fee         NUMERIC(10,2) DEFAULT 0,
  setup_fee_paid    BOOLEAN DEFAULT FALSE,
  status            TEXT DEFAULT 'ACTIVE',
  trial_end_date    DATE,
  start_date        DATE NOT NULL,
  next_billing_date DATE NOT NULL,
  last_billed_date  DATE,
  notes             TEXT,
  UNIQUE(tenant_id, module_code)
);
CREATE INDEX IF NOT EXISTS idx_tms_tenant_id   ON tenant_module_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tms_status       ON tenant_module_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_tms_next_billing ON tenant_module_subscriptions(next_billing_date);

CREATE TABLE IF NOT EXISTS domain_pre_verifications (
  id              TEXT PRIMARY KEY,
  domain          TEXT NOT NULL,
  token           TEXT NOT NULL,
  otp             TEXT,
  otp_email       TEXT,
  otp_expires_at  TIMESTAMPTZ,
  verified        BOOLEAN NOT NULL DEFAULT false,
  verified_method TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  template_name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  language TEXT DEFAULT 'en',
  body_en TEXT NOT NULL,
  body_ar TEXT,
  variables JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  usage_count INT DEFAULT 0
);

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'tenant_module_subscriptions']
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
