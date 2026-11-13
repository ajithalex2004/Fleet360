-- ============================================================================
-- RAC Security, Multi-Tenant RLS, Composite Uniques & Portal Session Hardening
-- ============================================================================

-- 1. RLS-01: Add tenant_id + ENABLE & FORCE ROW LEVEL SECURITY on pricing_rules
DO $$
DECLARE
  v_fallback_tenant TEXT;
BEGIN
  PERFORM set_config('app.tenant_id', '*', true);
  IF to_regclass('public.pricing_rules') IS NOT NULL THEN
    ALTER TABLE public.pricing_rules ADD COLUMN IF NOT EXISTS tenant_id TEXT;

    IF to_regclass('public.tenants') IS NOT NULL THEN
      SELECT id::text INTO v_fallback_tenant
        FROM public.tenants
       ORDER BY created_at ASC NULLS LAST
       LIMIT 1;
    END IF;

    IF v_fallback_tenant IS NOT NULL THEN
      UPDATE public.pricing_rules
         SET tenant_id = v_fallback_tenant
       WHERE tenant_id IS NULL;
    ELSE
      DELETE FROM public.pricing_rules WHERE tenant_id IS NULL;
    END IF;

    ALTER TABLE public.pricing_rules ALTER COLUMN tenant_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_pricing_rules_tenant_id ON public.pricing_rules (tenant_id);

    ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.pricing_rules FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON public.pricing_rules;
    CREATE POLICY tenant_isolation ON public.pricing_rules
      FOR ALL
      USING (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id::text = current_setting('app.tenant_id', true)
      )
      WITH CHECK (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id::text = current_setting('app.tenant_id', true)
      );

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_rules TO fleet360_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_rules TO fleet360_api_role;
    END IF;
  END IF;
END $$;

-- 2. RLS-02: Normalize live-DB uuid tenant_id drift to TEXT on rental_agreements & damage_claims
DO $$
DECLARE
  v_tbl TEXT;
  v_udt TEXT;
  v_pol RECORD;
  v_con RECORD;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['rental_agreements', 'damage_claims'] LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      SELECT udt_name INTO v_udt
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = v_tbl
         AND column_name = 'tenant_id';

      IF v_udt = 'uuid' THEN
        FOR v_pol IN
          SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = v_tbl
        LOOP
          EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_tbl);
        END LOOP;

        FOR v_con IN
          SELECT c.conname
            FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
           WHERE c.conrelid = ('public.' || v_tbl)::regclass
             AND c.contype = 'f'
             AND a.attname = 'tenant_id'
        LOOP
          EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', v_tbl, v_con.conname);
        END LOOP;

        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text', v_tbl);
      END IF;

      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', v_tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I FOR ALL ' ||
        'USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id::text = current_setting(''app.tenant_id'', true)) ' ||
        'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id::text = current_setting(''app.tenant_id'', true))',
        v_tbl
      );
    END IF;
  END LOOP;
END $$;

-- 3. RLS-03 & RLS-04: Enforce NOT NULL tenant_id + FORCE RLS across raw-SQL RAC tables & salik_accounts
DO $$
DECLARE
  v_tbl TEXT;
  v_fallback_tenant TEXT;
BEGIN
  PERFORM set_config('app.tenant_id', '*', true);
  IF to_regclass('public.tenants') IS NOT NULL THEN
    SELECT id::text INTO v_fallback_tenant
      FROM public.tenants
     ORDER BY created_at ASC NULLS LAST
     LIMIT 1;
  END IF;

  FOREACH v_tbl IN ARRAY ARRAY[
    'salik_accounts',
    'rental_branches',
    'rental_documents',
    'rental_insurance_policies',
    'rental_vehicle_transfers',
    'rental_inquiries',
    'rental_quotations',
    'rental_handovers',
    'rental_renewals'
  ] LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id TEXT', v_tbl);

      IF v_fallback_tenant IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = v_tbl AND column_name = 'tenant_id' AND udt_name = 'uuid'
        ) THEN
          EXECUTE format('UPDATE public.%I SET tenant_id = $1::uuid WHERE tenant_id IS NULL', v_tbl)
            USING v_fallback_tenant;
        ELSE
          EXECUTE format('UPDATE public.%I SET tenant_id = $1 WHERE tenant_id IS NULL', v_tbl)
            USING v_fallback_tenant;
        END IF;
      ELSE
        EXECUTE format('DELETE FROM public.%I WHERE tenant_id IS NULL', v_tbl);
      END IF;

      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', v_tbl);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)', 'idx_' || v_tbl || '_tenant_id', v_tbl);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', v_tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I FOR ALL ' ||
        'USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id::text = current_setting(''app.tenant_id'', true)) ' ||
        'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id::text = current_setting(''app.tenant_id'', true))',
        v_tbl
      );
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', v_tbl);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_api_role', v_tbl);
      END IF;
    END IF;
  END LOOP;
END $$;

-- 4. UNIQ-01..06: Drop standalone global unique indexes + constraints & create (tenant_id, ...) composites
DO $$
BEGIN
  -- rate_events.event_code
  IF to_regclass('public.rate_events') IS NOT NULL THEN
    ALTER TABLE public.rate_events DROP CONSTRAINT IF EXISTS rate_events_event_code_key;
    DROP INDEX IF EXISTS public.rate_events_event_code_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_events_tenant_code
      ON public.rate_events (tenant_id, event_code);
  END IF;

  -- rental_ancillaries.code
  IF to_regclass('public.rental_ancillaries') IS NOT NULL THEN
    ALTER TABLE public.rental_ancillaries DROP CONSTRAINT IF EXISTS rental_ancillaries_code_key;
    DROP INDEX IF EXISTS public.rental_ancillaries_code_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_ancillaries_tenant_code
      ON public.rental_ancillaries (tenant_id, code);
  END IF;

  -- rental_bookings.booking_ref (standalone index left behind by earlier DROP CONSTRAINT)
  IF to_regclass('public.rental_bookings') IS NOT NULL THEN
    ALTER TABLE public.rental_bookings DROP CONSTRAINT IF EXISTS rental_bookings_booking_ref_key;
    DROP INDEX IF EXISTS public.rental_bookings_booking_ref_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_bookings_tenant_ref
      ON public.rental_bookings (tenant_id, booking_ref)
      WHERE booking_ref IS NOT NULL;
  END IF;

  -- rental_invoice_payments.receipt_no
  IF to_regclass('public.rental_invoice_payments') IS NOT NULL THEN
    ALTER TABLE public.rental_invoice_payments DROP CONSTRAINT IF EXISTS rental_invoice_payments_receipt_no_key;
    DROP INDEX IF EXISTS public.rental_invoice_payments_receipt_no_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_invoice_payments_tenant_receipt
      ON public.rental_invoice_payments (tenant_id, receipt_no)
      WHERE receipt_no IS NOT NULL;
  END IF;

  -- rental_quotations.quote_no
  IF to_regclass('public.rental_quotations') IS NOT NULL THEN
    ALTER TABLE public.rental_quotations DROP CONSTRAINT IF EXISTS rental_quotations_quote_no_key;
    DROP INDEX IF EXISTS public.rental_quotations_quote_no_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_quotations_tenant_no
      ON public.rental_quotations (tenant_id, quote_no)
      WHERE quote_no IS NOT NULL;
  END IF;

  -- Ensure standalone unique indexes are also dropped for previously migrated RAC tables
  DROP INDEX IF EXISTS public.rental_invoices_invoice_no_key;
  DROP INDEX IF EXISTS public.rental_branches_branch_code_key;
  DROP INDEX IF EXISTS public.rental_vehicle_transfers_transfer_no_key;
  DROP INDEX IF EXISTS public.rental_documents_doc_ref_key;
  DROP INDEX IF EXISTS public.rental_insurance_policies_policy_no_key;
  DROP INDEX IF EXISTS public.salik_accounts_tag_number_key;
END $$;

-- 5. B2B RAC Portal User Session Revocation & Partial Case-Insensitive Unique Email
DO $$
BEGIN
  IF to_regclass('public.rac_portal_users') IS NOT NULL THEN
    ALTER TABLE public.rac_portal_users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 1;
    ALTER TABLE public.rac_portal_users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

    ALTER TABLE public.rac_portal_users DROP CONSTRAINT IF EXISTS rac_portal_users_tenant_id_email_key;
    DROP INDEX IF EXISTS public.rac_portal_users_tenant_id_email_key;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_rac_portal_users_tenant_email_active
      ON public.rac_portal_users (tenant_id, lower(email))
      WHERE deleted_at IS NULL;
  END IF;
END $$;

-- 6. Per-Tenant OTA Channel Webhook Configuration (prevents cross-tenant webhook forgery)
CREATE TABLE IF NOT EXISTS public.rental_channel_configs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT NOT NULL,
  channel_key    TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_rental_channel_configs_tenant_channel UNIQUE (tenant_id, channel_key)
);

CREATE INDEX IF NOT EXISTS idx_rental_channel_configs_tenant_id
  ON public.rental_channel_configs (tenant_id);

ALTER TABLE public.rental_channel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_channel_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.rental_channel_configs;
CREATE POLICY tenant_isolation ON public.rental_channel_configs
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_channel_configs TO fleet360_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_channel_configs TO fleet360_api_role;
  END IF;
END $$;
