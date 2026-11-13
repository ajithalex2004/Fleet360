-- ============================================================================
-- Fleet360 RAC Workflow Consolidation, Multi-Tenant Uniques & B2B Portal + Card Pre-Auth
-- ============================================================================

-- 1. Catch-up columns on core RAC lifecycle tables
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS vehicle_inspections ADD COLUMN IF NOT EXISTS photos TEXT;
ALTER TABLE IF EXISTS vehicle_inspections ADD COLUMN IF NOT EXISTS damage_markers JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS vehicle_inspections ADD COLUMN IF NOT EXISTS checklist_items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS vehicle_inspections ADD COLUMN IF NOT EXISTS signature_url TEXT;

ALTER TABLE IF EXISTS rental_extensions ADD COLUMN IF NOT EXISTS renewal_no TEXT;
ALTER TABLE IF EXISTS rental_extensions ADD COLUMN IF NOT EXISTS daily_rate DECIMAL;
ALTER TABLE IF EXISTS rental_extensions ADD COLUMN IF NOT EXISTS vat_amount DECIMAL DEFAULT 0;
ALTER TABLE IF EXISTS rental_extensions ADD COLUMN IF NOT EXISTS total_amount DECIMAL;
ALTER TABLE IF EXISTS rental_extensions ADD COLUMN IF NOT EXISTS deposit_top_up DECIMAL DEFAULT 0;
ALTER TABLE IF EXISTS rental_extensions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS rental_extensions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS rental_extensions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Replace legacy global single-column UNIQUE constraints with tenant-scoped composites
DO $$
BEGIN
  IF to_regclass('public.rental_invoices') IS NOT NULL THEN
    ALTER TABLE public.rental_invoices DROP CONSTRAINT IF EXISTS rental_invoices_invoice_no_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_invoices_tenant_no ON public.rental_invoices (tenant_id, invoice_no);
  END IF;

  IF to_regclass('public.rental_branches') IS NOT NULL THEN
    ALTER TABLE public.rental_branches DROP CONSTRAINT IF EXISTS rental_branches_branch_code_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_branches_tenant_code ON public.rental_branches (tenant_id, branch_code);
  END IF;

  IF to_regclass('public.rental_vehicle_transfers') IS NOT NULL THEN
    ALTER TABLE public.rental_vehicle_transfers DROP CONSTRAINT IF EXISTS rental_vehicle_transfers_transfer_no_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_vehicle_transfers_tenant_no ON public.rental_vehicle_transfers (tenant_id, transfer_no);
  END IF;

  IF to_regclass('public.rental_documents') IS NOT NULL THEN
    ALTER TABLE public.rental_documents DROP CONSTRAINT IF EXISTS rental_documents_doc_ref_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_documents_tenant_ref ON public.rental_documents (tenant_id, doc_ref);
  END IF;

  IF to_regclass('public.rental_insurance_policies') IS NOT NULL THEN
    ALTER TABLE public.rental_insurance_policies DROP CONSTRAINT IF EXISTS rental_insurance_policies_policy_no_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_insurance_policies_tenant_no ON public.rental_insurance_policies (tenant_id, policy_no);
  END IF;

  IF to_regclass('public.rental_extensions') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_extensions_tenant_renewal_no
      ON public.rental_extensions (tenant_id, renewal_no)
      WHERE renewal_no IS NOT NULL;
  END IF;
END $$;

-- 3. Standalone Authenticated B2B RAC Portal Users & Invitations
CREATE TABLE IF NOT EXISTS rac_portal_users (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT         NOT NULL,
  customer_id     TEXT         NOT NULL,
  email           TEXT         NOT NULL,
  full_name       TEXT,
  phone           TEXT,
  password_hash   TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  role            TEXT         NOT NULL DEFAULT 'RAC_B2B_USER',
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_rac_portal_users_customer ON rac_portal_users (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rac_portal_users_tenant_email ON rac_portal_users (tenant_id, email) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS rac_portal_invitations (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT         NOT NULL,
  portal_user_id       UUID         NOT NULL,
  token_hash           TEXT         NOT NULL,
  expires_at           TIMESTAMPTZ  NOT NULL,
  invited_by_user_id   TEXT         NOT NULL,
  accepted_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rac_portal_invites_token_hash ON rac_portal_invitations (token_hash) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rac_portal_invites_user ON rac_portal_invitations (portal_user_id, created_at DESC);

-- 4. Card Pre-Authorization & Deposit Hold Ledger
CREATE TABLE IF NOT EXISTS rac_card_preauths (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT         NOT NULL,
  customer_id         TEXT         NOT NULL,
  booking_id          TEXT,
  agreement_id        TEXT,
  invoice_id          TEXT,
  amount              NUMERIC      NOT NULL,
  captured_amount     NUMERIC      NOT NULL DEFAULT 0,
  currency            TEXT         NOT NULL DEFAULT 'AED',
  provider            TEXT         NOT NULL DEFAULT 'sandbox',
  provider_intent_id  TEXT,
  card_token          TEXT,
  authorization_code  TEXT         NOT NULL,
  card_brand          TEXT,
  card_last4          TEXT,
  cardholder_name     TEXT,
  status              TEXT         NOT NULL DEFAULT 'AUTHORIZED',
  expires_at          TIMESTAMPTZ,
  captured_at         TIMESTAMPTZ,
  released_at         TIMESTAMPTZ,
  initiated_by        TEXT         NOT NULL DEFAULT 'PORTAL_USER',
  initiated_by_user   TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rac_card_preauths_tenant_customer ON rac_card_preauths (tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rac_card_preauths_booking ON rac_card_preauths (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rac_card_preauths_agreement ON rac_card_preauths (agreement_id) WHERE agreement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rac_card_preauths_tenant_authcode ON rac_card_preauths (tenant_id, authorization_code);

-- 5. Enable & Force Row-Level Security on B2B RAC Portal & Pre-Auth Tables
DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  targets   text[][] := ARRAY[
    ARRAY['public', 'rac_portal_users'],
    ARRAY['public', 'rac_portal_invitations'],
    ARRAY['public', 'rac_card_preauths']
  ];
  i int;
  sch text;
  tbl text;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    sch := targets[i][1];
    tbl := targets[i][2];

    IF to_regclass(quote_ident(sch) || '.' || quote_ident(tbl)) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT data_type, is_nullable INTO coltype, nullable
      FROM information_schema.columns
     WHERE table_schema = sch AND table_name = tbl AND column_name = 'tenant_id';

    IF coltype IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I WHERE tenant_id IS NULL', sch, tbl) INTO nulls;
    IF nullable = 'YES' AND nulls = 0 THEN
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN tenant_id SET NOT NULL', sch, tbl);
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

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO fleet360_app', sch, tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO fleet360_api_role', sch, tbl);
    END IF;
  END LOOP;
END $$;

-- 6. Multi-Tenant Isolation & RLS on salik_accounts
DO $$
BEGIN
  IF to_regclass('public.salik_accounts') IS NOT NULL THEN
    PERFORM set_config('app.tenant_id', '*', true);
    ALTER TABLE public.salik_accounts ADD COLUMN IF NOT EXISTS tenant_id TEXT;

    IF to_regclass('public.vehicles') IS NOT NULL THEN
      UPDATE public.salik_accounts sa
         SET tenant_id = v.tenant_id::text
        FROM public.vehicles v
       WHERE sa.tenant_id IS NULL
         AND sa.vehicle_id IS NOT NULL
         AND v.id::text = sa.vehicle_id::text;
    END IF;

    ALTER TABLE public.salik_accounts DROP CONSTRAINT IF EXISTS salik_accounts_tag_number_key;
    DROP INDEX IF EXISTS public.salik_accounts_tag_number_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_salik_accounts_tenant_tag
      ON public.salik_accounts (tenant_id, tag_number);
    CREATE INDEX IF NOT EXISTS idx_salik_accounts_tenant_id
      ON public.salik_accounts (tenant_id);

    DROP POLICY IF EXISTS tenant_isolation ON public.salik_accounts;
    CREATE POLICY tenant_isolation ON public.salik_accounts
      FOR ALL
      USING (
        (current_setting('app.tenant_id', true) = '*')
        OR (tenant_id::text = current_setting('app.tenant_id', true))
      )
      WITH CHECK (
        (current_setting('app.tenant_id', true) = '*')
        OR (tenant_id::text = current_setting('app.tenant_id', true))
      );

    ALTER TABLE public.salik_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.salik_accounts FORCE ROW LEVEL SECURITY;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.salik_accounts TO fleet360_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.salik_accounts TO fleet360_api_role;
    END IF;
  END IF;
END $$;
