-- Move runtime DDL out of src/lib/leasing/payment-schema.ts,
-- src/lib/leasing/self-service-schema.ts, and src/lib/leasing-portal/schema.ts.

CREATE TABLE IF NOT EXISTS lease_payment_intents (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT         NOT NULL,
  invoice_id        TEXT         NOT NULL,
  lessee_id         TEXT         NOT NULL,
  amount            NUMERIC      NOT NULL,
  currency          TEXT         NOT NULL DEFAULT 'AED',
  provider          TEXT         NOT NULL DEFAULT 'stub',
  provider_ref      TEXT,
  method            TEXT         NOT NULL DEFAULT 'BANK_TRANSFER',
  status            TEXT         NOT NULL DEFAULT 'PENDING',
  initiated_by      TEXT         NOT NULL DEFAULT 'LESSEE',
  initiated_by_user TEXT,
  reference_code    TEXT         NOT NULL,
  notes             TEXT,
  confirmed_at      TIMESTAMPTZ,
  confirmed_by      TEXT,
  receipt_id        TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_invoice ON lease_payment_intents (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_tenant_status ON lease_payment_intents (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_lessee ON lease_payment_intents (lessee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lease_damage_reports (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT         NOT NULL,
  lessee_id     TEXT         NOT NULL,
  contract_id   TEXT         NOT NULL,
  vehicle_ref   TEXT,
  severity      TEXT         NOT NULL DEFAULT 'MODERATE',
  description   TEXT         NOT NULL,
  photo_urls    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  status        TEXT         NOT NULL DEFAULT 'SUBMITTED',
  reported_by   TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_damage_reports_lessee ON lease_damage_reports (tenant_id, lessee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_damage_reports_contract ON lease_damage_reports (contract_id);

CREATE TABLE IF NOT EXISTS lease_esignatures (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT         NOT NULL,
  lessee_id      TEXT         NOT NULL,
  entity_type    TEXT         NOT NULL,
  entity_id      TEXT         NOT NULL,
  signer_name    TEXT         NOT NULL,
  signer_email   TEXT         NOT NULL,
  ip_address     TEXT,
  user_agent     TEXT,
  accepted_text  TEXT         NOT NULL,
  content_hash   TEXT         NOT NULL,
  signed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_esignatures_entity ON lease_esignatures (entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_esignatures_entity ON lease_esignatures (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS lessee_portal_users (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT         NOT NULL,
  lessee_id       TEXT         NOT NULL,
  email           TEXT         NOT NULL,
  full_name       TEXT,
  phone           TEXT,
  password_hash   TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  role            TEXT         NOT NULL DEFAULT 'LESSEE_USER',
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_lessee_portal_users_lessee ON lessee_portal_users (lessee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lessee_portal_users_tenant_email ON lessee_portal_users (tenant_id, email) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lessee_portal_invitations (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT         NOT NULL,
  portal_user_id       UUID         NOT NULL,
  token_hash           TEXT         NOT NULL,
  expires_at           TIMESTAMPTZ  NOT NULL,
  invited_by_user_id   TEXT         NOT NULL,
  accepted_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lessee_portal_invites_token_hash ON lessee_portal_invitations (token_hash) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lessee_portal_invites_user ON lessee_portal_invitations (portal_user_id, created_at DESC);

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'lease_payment_intents'],
    ARRAY['public', 'lease_damage_reports'],
    ARRAY['public', 'lease_esignatures'],
    ARRAY['public', 'lessee_portal_users'],
    ARRAY['public', 'lessee_portal_invitations']
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
