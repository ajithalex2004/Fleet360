-- Move runtime DDL out of src/lib/shipper-portal/schema.ts.
--
-- The ALTER statements on `customers` and `logistics_shipment_orders`
-- (both owned by src/lib/logistics/domain.ts's ensureLogisticsDomainTables,
-- deferred/out of scope) are guarded with an existence check, mirroring
-- the original runtime code's .catch(() => {}) intent: "if customers
-- doesn't exist yet (early dev tenant), skip — fine, the column gets
-- added whenever that table shows up." A bare ALTER TABLE here (unlike
-- CREATE TABLE IF NOT EXISTS) would hard-fail the whole migration if the
-- table isn't there yet, which the original runtime code never did.

CREATE TABLE IF NOT EXISTS customer_portal_users (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT         NOT NULL,
  customer_id     TEXT         NOT NULL,
  email           TEXT         NOT NULL,
  full_name       TEXT,
  phone           TEXT,
  password_hash   TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  role            TEXT         NOT NULL DEFAULT 'SHIPPER_USER',
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_portal_users_customer ON customer_portal_users (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_users_tenant_email ON customer_portal_users (tenant_id, email) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_portal_invitations (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT         NOT NULL,
  portal_user_id       UUID         NOT NULL,
  token_hash           TEXT         NOT NULL,
  expires_at           TIMESTAMPTZ  NOT NULL,
  invited_by_user_id   TEXT         NOT NULL,
  accepted_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_invites_token_hash ON customer_portal_invitations (token_hash) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_invites_user ON customer_portal_invitations (portal_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id  TEXT  PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS default_portal_tracking_level TEXT NOT NULL DEFAULT 'STATUS_ONLY';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS portal_tracking_level TEXT NOT NULL DEFAULT 'STATUS_ONLY';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'logistics_shipment_orders') THEN
    ALTER TABLE logistics_shipment_orders ADD COLUMN IF NOT EXISTS portal_tracking_level TEXT;
    ALTER TABLE logistics_shipment_orders ADD COLUMN IF NOT EXISTS portal_tracking_override_reason TEXT;
    ALTER TABLE logistics_shipment_orders ADD COLUMN IF NOT EXISTS source_channel TEXT;
  END IF;
END $$;

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'customer_portal_users'],
    ARRAY['public', 'customer_portal_invitations'],
    ARRAY['public', 'tenant_settings']
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
