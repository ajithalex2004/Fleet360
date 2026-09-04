-- Move runtime DDL out of src/app/api/auth/forgot-password/route.ts,
-- src/lib/api-keys.ts, src/lib/audit.ts, and src/lib/invitations.ts.
--
-- password_reset_tokens is keyed by user_id / token_hash, never listed
-- per-tenant (the only reads are "does this token match" or "this user's
-- own tokens") — no tenant_id column, no RLS, by design, same category as
-- domain_pre_verifications.
--
-- tenant_api_keys, tenant_invitations, and audit_logs all carry tenant_id
-- and get the canonical RLS policy below.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT         NOT NULL,
  token_hash  TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ  NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked     BOOLEAN      NOT NULL DEFAULT FALSE,
  ip_address  TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id, expires_at);

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT         NOT NULL,
  name            TEXT         NOT NULL,
  prefix          TEXT         NOT NULL,
  key_hash        TEXT         NOT NULL,
  scopes          JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id TEXT,
  last_used_at    TIMESTAMPTZ,
  last_used_ip    TEXT,
  revoked         BOOLEAN      NOT NULL DEFAULT FALSE,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_prefix ON tenant_api_keys (prefix);

CREATE TABLE IF NOT EXISTS tenant_invitations (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT         NOT NULL,
  email                TEXT         NOT NULL,
  role_id              TEXT         NOT NULL,
  token_hash           TEXT         NOT NULL,
  invited_by_user_id   TEXT,
  expires_at           TIMESTAMPTZ  NOT NULL,
  used_at              TIMESTAMPTZ,
  revoked              BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant ON tenant_invitations (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_hash   ON tenant_invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email  ON tenant_invitations (LOWER(email));

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT,
  tenant_name   TEXT,
  branch_id     TEXT,
  branch_name   TEXT,
  entity_type   TEXT        NOT NULL,
  entity_id     TEXT,
  entity_name   TEXT,
  user_id       TEXT,
  user_name     TEXT,
  user_email    TEXT,
  user_role     TEXT,
  action        TEXT        NOT NULL,
  details       TEXT,
  ip_address    TEXT,
  user_agent    TEXT,
  session_id    TEXT,
  login_time    TIMESTAMPTZ,
  logout_time   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS branch_id   TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS branch_name TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_tenant  ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'tenant_api_keys'],
    ARRAY['public', 'tenant_invitations'],
    ARRAY['public', 'audit_logs']
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
