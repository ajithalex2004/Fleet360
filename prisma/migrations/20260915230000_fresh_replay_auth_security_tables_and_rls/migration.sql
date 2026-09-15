-- Closes the "20260910000024" row from issue #77's audit.
--
-- 20260910000024_auth_security_tables_and_rls is already applied on every
-- real environment and is left untouched, same approach as every migration
-- in this series. password_reset_tokens and tenant_api_keys are created
-- here for the first and only time anywhere in tracked history — no
-- conflict, no fix needed for either.
--
-- tenant_invitations and audit_logs are each defined TWICE, by two
-- different migrations, with genuinely incompatible shapes — not an
-- ordering gap like everywhere else in this series, a real duplicate
-- definition:
--
--   tenant_invitations: first by 20260625130000_multi_tenant_saas_layer2_5
--   (id/created_at/updated_at, tenant_id+role_id as FKs, a plaintext
--   `token` column with a UNIQUE constraint, `invited_by`/`accepted_at`/
--   `revoked_at`, `accepted_user_id`, `metadata`), second here (no FKs, a
--   `token_hash` column instead of `token`, `invited_by_user_id` instead of
--   `invited_by`, `used_at`/`revoked BOOLEAN` instead of `accepted_at`/
--   `revoked_at`, no `accepted_user_id`/`metadata`/`updated_at`).
--
--   audit_logs: first by 20260901000000_p0_baseline_audit_logs (id TEXT,
--   a `changes JSONB` column, entity_type/created_at nullable), second here
--   (id UUID, no `changes`, entity_type/created_at NOT NULL, and nine
--   columns — tenant_name, entity_name, user_name, user_email, user_role,
--   details, session_id, login_time, logout_time — the first definition
--   never mentions).
--
-- CREATE TABLE IF NOT EXISTS means whichever definition runs first wins
-- outright; the second is a silent no-op against the wrong shape. On live
-- this was never observable because both tables predate both migrations —
-- created via the untracked legacy path in their FINAL shape from the
-- start (confirmed by pg_dump against production), so neither CREATE TABLE
-- statement, in either migration, ever actually ran. On a fresh replay,
-- 20260625130000 and 20260901000000 run first (much earlier in file order)
-- against a genuinely empty database, so their CREATE TABLE statements
-- actually execute — locking in the OLDER, WRONG shape before this
-- migration ever gets a chance to run. The `column "token_hash" does not
-- exist` failure is 20260910000024's own CREATE INDEX statement hitting a
-- table that, on a fresh replay, was built from the first, incompatible
-- definition.
--
-- Fix: reconcile the already-created (wrong-shape) tables into their exact
-- live shape via targeted ALTER statements — rename/retype/add/drop as
-- needed, each guarded so it is a safe no-op wherever the table is already
-- in the target shape (every real environment). Then re-run the original's
-- own CREATE TABLE/INDEX statements verbatim (now no-ops against the
-- corrected shape) and its tighten loop, WITH ONE DELIBERATE CHANGE
-- explained below.
--
-- audit_logs is EXCLUDED from the tighten loop's policy rebuild. The
-- original loop unconditionally does
-- `DROP POLICY IF EXISTS tenant_isolation` + `CREATE POLICY tenant_isolation
-- ... FOR ALL`, but audit_logs' actual, currently-functioning live policy
-- set (confirmed via pg_dump) is FOUR policies: audit_insert_only (INSERT),
-- audit_no_deletes (DELETE, USING false), audit_no_updates (UPDATE, USING
-- false), and tenant_isolation restricted to SELECT only — all four
-- PERMISSIVE (confirmed via pg_policies), from
-- 20260901000001_p0_audit_logs_rls, which already runs successfully earlier
-- in this same chain. Multiple PERMISSIVE policies for the same command are
-- combined with OR, not AND: if the loop's literal code ran and replaced
-- tenant_isolation with a FOR ALL version, an UPDATE from a same-tenant
-- session would evaluate TRUE on the new tenant_isolation policy and TRUE
-- OR FALSE (from audit_no_updates) is TRUE — silently reopening UPDATE and
-- DELETE on a table whose entire purpose is to be append-only. Live's
-- actual current state does not have this regression (still SELECT-only),
-- so whatever ran that migration's SQL on live either never reached this
-- table's policy rebuild or had it corrected out-of-band afterward — either
-- way, live's real behavior is the append-only one, and this fix
-- reproduces THAT, not the loop's literal code, for this one table.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260910000024_auth_security_tables_and_rls

-- ── password_reset_tokens / tenant_api_keys — no conflict, verbatim ────────

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

-- ── tenant_invitations — reconcile the pre-existing (wrong-shape) table ────

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

DO $$
BEGIN
  IF to_regclass('public.tenant_invitations') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tenant_invitations' AND column_name = 'token')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tenant_invitations' AND column_name = 'token_hash') THEN
    ALTER TABLE public.tenant_invitations RENAME COLUMN token TO token_hash;
  END IF;
  ALTER TABLE public.tenant_invitations DROP CONSTRAINT IF EXISTS tenant_invitations_token_key;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tenant_invitations' AND column_name = 'invited_by')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tenant_invitations' AND column_name = 'invited_by_user_id') THEN
    ALTER TABLE public.tenant_invitations RENAME COLUMN invited_by TO invited_by_user_id;
  END IF;
  ALTER TABLE public.tenant_invitations DROP CONSTRAINT IF EXISTS tenant_invitations_invited_by_fkey;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tenant_invitations' AND column_name = 'accepted_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tenant_invitations' AND column_name = 'used_at') THEN
    ALTER TABLE public.tenant_invitations RENAME COLUMN accepted_at TO used_at;
  END IF;

  -- revoked_at (timestamp) and revoked (boolean) are different fields, not a
  -- rename — add the live shape's column, drop the old one.
  ALTER TABLE public.tenant_invitations ADD COLUMN IF NOT EXISTS revoked BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE public.tenant_invitations DROP COLUMN IF EXISTS revoked_at;

  ALTER TABLE public.tenant_invitations DROP COLUMN IF EXISTS accepted_user_id;
  ALTER TABLE public.tenant_invitations DROP COLUMN IF EXISTS metadata;
  ALTER TABLE public.tenant_invitations DROP COLUMN IF EXISTS updated_at;

  ALTER TABLE public.tenant_invitations DROP CONSTRAINT IF EXISTS tenant_invitations_tenant_id_fkey;
  ALTER TABLE public.tenant_invitations DROP CONSTRAINT IF EXISTS tenant_invitations_role_id_fkey;

  -- idx_tenant_invitations_email pre-existed as a plain (non-expression)
  -- index under this same name from the older migration; IF NOT EXISTS
  -- would otherwise leave that stale definition in place forever.
  DROP INDEX IF EXISTS idx_tenant_invitations_email;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant ON tenant_invitations (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_hash   ON tenant_invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email  ON tenant_invitations (LOWER(email));

-- ── audit_logs — reconcile the pre-existing (wrong-shape) table ────────────

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

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RETURN;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'id') = 'text' THEN
    ALTER TABLE public.audit_logs ALTER COLUMN id TYPE uuid USING id::uuid;
  END IF;

  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS tenant_name text;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS entity_name text;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_name text;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_email text;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_role text;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details text;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS session_id text;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS login_time timestamptz;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS logout_time timestamptz;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS branch_id text;
  ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS branch_name text;

  -- `changes` is not part of live's shape. Only drop it if nothing has been
  -- written there — on a fresh replay this table is empty; on a real
  -- environment where it somehow isn't, leave it rather than lose data.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'changes') THEN
    IF (SELECT count(*) FROM public.audit_logs WHERE changes IS NOT NULL) = 0 THEN
      ALTER TABLE public.audit_logs DROP COLUMN changes;
    ELSE
      RAISE NOTICE 'audit_logs.changes has data — not dropping; not part of the live shape, review before removing';
    END IF;
  END IF;

  IF (SELECT count(*) FROM public.audit_logs WHERE entity_type IS NULL) = 0 THEN
    ALTER TABLE public.audit_logs ALTER COLUMN entity_type SET NOT NULL;
  END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE created_at IS NULL) = 0 THEN
    ALTER TABLE public.audit_logs ALTER COLUMN created_at SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_tenant  ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

-- ── Tighten loop — verbatim from the original, MINUS audit_logs ────────────
-- See the top-of-file comment for why audit_logs is excluded.

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'tenant_api_keys'],
    ARRAY['public', 'tenant_invitations']
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

-- audit_logs still needs RLS enabled+forced (already true on every real
-- environment) even though its policies are left untouched above.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
