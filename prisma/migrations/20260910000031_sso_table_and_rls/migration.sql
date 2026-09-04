-- Move runtime DDL out of src/lib/sso.ts. tenant_sso_configs already
-- carries a NOT NULL UNIQUE tenant_id and its sole caller
-- (src/app/api/admin/tenants/[id]/sso/route.ts) already wraps every
-- query in withTenantRls with a comment anticipating this exact RLS
-- policy — see that file's companion fix switching its cross-tenant
-- domain-conflict check to withPlatformAdmin, needed because that one
-- query intentionally reads across tenants and would otherwise see zero
-- rows once FORCE ROW LEVEL SECURITY is on.

CREATE TABLE IF NOT EXISTS tenant_sso_configs (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                TEXT         NOT NULL UNIQUE,
  provider                 TEXT         NOT NULL DEFAULT 'oidc',
  issuer                   TEXT         NOT NULL,
  client_id                TEXT         NOT NULL,
  client_secret_encrypted  TEXT         NOT NULL,
  allowed_email_domains    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  default_role_id          TEXT,
  jit_enabled              BOOLEAN      NOT NULL DEFAULT TRUE,
  is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by_user_id       TEXT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_sso_active ON tenant_sso_configs (is_active) WHERE is_active = TRUE;

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'tenant_sso_configs']
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
