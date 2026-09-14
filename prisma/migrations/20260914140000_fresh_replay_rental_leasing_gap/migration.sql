-- Fresh-DB-replay gap closure for the rental/leasing tenant-isolation domain.
-- Option A from issue #73 (github.com/ajithalex2004/Fleet360/issues/73).
--
-- 20260815140000_tenant_001_leasing_rental_isolation already applied on every
-- real environment, so it is not edited here — it is additive-only, same
-- approach as 20260914010000/20260914130000 before it. It hard-fails on a
-- genuinely fresh replay for two independent reasons, both confirmed against
-- the live database before writing this migration (not guessed):
--
-- 1. FIVE TABLES it assumes exist were never created by any tracked
--    migration — only via the same untracked legacy path that created
--    trip_schedules/trip_stop_visits before this session's earlier fix:
--      rental_rate_quotes, rental_vehicle_exchanges, rental_invoices,
--      rental_invoice_line_items, rental_invoice_payments
--    All five already have ENABLE+FORCE RLS and a correct tenant_isolation
--    policy live — the CREATE TABLE below reproduces their real, live DDL
--    exactly (pg_dump'd from the live database), not a hand guess.
--
-- 2. FIVE of the migration's tenant_id backfill UPDATE statements join
--    through the wrong parent. They assume a direct booking_id FK to
--    rental_bookings; the real FK (confirmed against both schema.prisma and
--    the live DDL) is agreement_id, through rental_agreements:
--      rental_extensions, rental_payments, rental_additional_charges,
--      rental_vehicle_exchanges, rental_invoices
--    On a fresh replay this is a hard error (column does not exist) for the
--    three tables that already exist at that point in history. This
--    migration re-runs the CORRECTED backfill, guarded to only touch rows
--    still missing tenant_id — a genuine no-op on every real environment,
--    where backfill already happened correctly via whatever untracked path
--    originally set these tables up.
--
-- Because 20260815140000 still hard-fails before reaching its own RLS
-- section on a fresh replay, none of the 19 tables in that section receive
-- RLS from it in that scenario either — 8 of the 19 are separately covered
-- by 20260910000000_remove_null_tenant_escape (rental_customers,
-- rental_bookings, rental_rate_quotes, rental_agreements, rental_ancillaries,
-- rental_invoices, damage_claims, rate_events); the other 11 would end up
-- with NO RLS at all on a fresh replay. Section 3 below closes that for all
-- 19, unconditionally — a safe no-op on every real environment, where all 19
-- already have identical RLS live (verified directly, not assumed).
--
-- A genuinely fresh database still needs an operator to run, before
-- deploying further:
--   npx prisma migrate resolve --applied 20260815140000_tenant_001_leasing_rental_isolation
-- 20260815140000 cannot be made to succeed as written without editing an
-- already-applied migration, which is unsafe. This migration is what makes
-- that one manual step sufficient — everything after it is unattended again.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The 5 untracked tables — exact live DDL, idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rental_rate_quotes (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    booking_id text,
    vehicle_category text NOT NULL,
    pickup_date timestamp with time zone NOT NULL,
    dropoff_date timestamp with time zone NOT NULL,
    total_days integer NOT NULL,
    total_hours integer,
    applied_rule_id text,
    currency text DEFAULT 'AED'::text,
    base_rental_charge numeric NOT NULL,
    insurance_plan_code text,
    insurance_charge numeric DEFAULT 0,
    extras text,
    discount_pct numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    tax_pct numeric DEFAULT 5,
    tax_amount numeric DEFAULT 0,
    total_amount numeric NOT NULL,
    breakdown text,
    expires_at timestamp with time zone,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_rate_quotes_booking_id ON public.rental_rate_quotes USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_rental_rate_quotes_tenant_id ON public.rental_rate_quotes USING btree (tenant_id);

CREATE TABLE IF NOT EXISTS public.rental_vehicle_exchanges (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    agreement_id text NOT NULL REFERENCES public.rental_agreements(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    from_vehicle_id text NOT NULL,
    to_vehicle_id text NOT NULL,
    exchange_date timestamp with time zone NOT NULL,
    reason text,
    mileage_at_exchange integer,
    fuel_at_exchange integer,
    rate_difference numeric,
    authorized_by text,
    notes text,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_vehicle_exchanges_agreement_id ON public.rental_vehicle_exchanges USING btree (agreement_id);
CREATE INDEX IF NOT EXISTS idx_rental_vehicle_exchanges_tenant ON public.rental_vehicle_exchanges USING btree (tenant_id);

CREATE TABLE IF NOT EXISTS public.rental_invoices (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    invoice_no text NOT NULL UNIQUE,
    agreement_id text NOT NULL REFERENCES public.rental_agreements(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    customer_id text NOT NULL,
    invoice_type text DEFAULT 'STANDARD'::text,
    invoice_date timestamp with time zone NOT NULL,
    due_date timestamp with time zone NOT NULL,
    period_from timestamp with time zone,
    period_to timestamp with time zone,
    currency text DEFAULT 'AED'::text,
    subtotal numeric NOT NULL,
    discount_amount numeric DEFAULT 0,
    taxable_amount numeric DEFAULT 0,
    tax_rate numeric DEFAULT 5,
    tax_amount numeric DEFAULT 0,
    total_amount numeric NOT NULL,
    paid_amount numeric DEFAULT 0,
    balance_due numeric,
    status text DEFAULT 'DRAFT'::text,
    is_corporate boolean DEFAULT false,
    corporate_account_id text,
    billing_mode text DEFAULT 'SEPARATE'::text,
    payment_terms_days integer DEFAULT 30,
    sent_at timestamp with time zone,
    paid_at timestamp with time zone,
    voided_at timestamp with time zone,
    void_reason text,
    parent_invoice_id text,
    notes text,
    internal_notes text,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_agreement_id ON public.rental_invoices USING btree (agreement_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_corporate_account_id ON public.rental_invoices USING btree (corporate_account_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_customer_id ON public.rental_invoices USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_deleted_at ON public.rental_invoices USING btree (deleted_at);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_due_date ON public.rental_invoices USING btree (due_date);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_status ON public.rental_invoices USING btree (status);
CREATE INDEX IF NOT EXISTS idx_rental_invoices_tenant_id ON public.rental_invoices USING btree (tenant_id);

CREATE TABLE IF NOT EXISTS public.rental_invoice_line_items (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    invoice_id text NOT NULL REFERENCES public.rental_invoices(id) ON UPDATE CASCADE ON DELETE CASCADE,
    line_type text NOT NULL,
    description text NOT NULL,
    quantity numeric NOT NULL,
    unit_price numeric NOT NULL,
    unit_label text DEFAULT 'day'::text,
    discount_pct numeric DEFAULT 0,
    taxable boolean DEFAULT true,
    amount numeric NOT NULL,
    sort_order integer DEFAULT 0,
    reference_id text,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_line_items_invoice_id ON public.rental_invoice_line_items USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_line_items_tenant ON public.rental_invoice_line_items USING btree (tenant_id);

CREATE TABLE IF NOT EXISTS public.rental_invoice_payments (
    id text NOT NULL PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    invoice_id text NOT NULL REFERENCES public.rental_invoices(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    receipt_no text UNIQUE,
    amount numeric NOT NULL,
    currency text DEFAULT 'AED'::text,
    payment_method text,
    reference_no text,
    notes text,
    received_by text,
    paid_at timestamp(6) with time zone NOT NULL,
    tenant_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_payments_invoice_id ON public.rental_invoice_payments USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_rental_invoice_payments_tenant ON public.rental_invoice_payments USING btree (tenant_id);

DO $$
DECLARE
  tbl text;
  targets text[] := ARRAY[
    'rental_rate_quotes', 'rental_vehicle_exchanges', 'rental_invoices',
    'rental_invoice_line_items', 'rental_invoice_payments'
  ];
BEGIN
  FOREACH tbl IN ARRAY targets LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', tbl);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Corrected tenant_id backfill — joins through rental_agreements, not
--    rental_bookings. No-op wherever tenant_id is already set.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE rental_extensions x
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE x.agreement_id = a.id AND x.tenant_id IS NULL;

UPDATE rental_payments p
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE p.agreement_id = a.id AND p.tenant_id IS NULL;

UPDATE rental_additional_charges c
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE c.agreement_id = a.id AND c.tenant_id IS NULL;

UPDATE rental_vehicle_exchanges e
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE e.agreement_id = a.id AND e.tenant_id IS NULL;

UPDATE rental_invoices i
SET tenant_id = a.tenant_id
FROM rental_agreements a
WHERE i.agreement_id = a.id AND i.tenant_id IS NULL;

DO $$
DECLARE n bigint;
BEGIN
  SELECT COUNT(*) INTO n FROM (
    SELECT 1 FROM rental_extensions WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_payments WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_additional_charges WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_vehicle_exchanges WHERE tenant_id IS NULL
    UNION ALL SELECT 1 FROM rental_invoices WHERE tenant_id IS NULL
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION 'issue #73 backfill: % rows still have NULL tenant_id after the corrected join — orphaned from rental_agreements, needs manual review', n;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. RLS for all 19 tables from 20260815140000's own (never-reached, on a
--    fresh replay) RLS section. Idempotent; verified identical to the live
--    policy on every one of the 19 before writing this. Per-column-type cast
--    (rental_agreements, damage_claims are uuid; the rest are text), same
--    approach as 20260910000000 and 20260914130000.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t       text;
  coltype text;
  expr    text;
  targets text[] := ARRAY[
    'lease_quotation_items', 'lease_quotation_vehicles', 'lease_contract_vehicles',
    'lease_invoice_lines', 'rental_customers', 'rental_bookings', 'rental_rate_quotes',
    'rental_agreements', 'rental_vehicle_exchanges', 'rental_extensions', 'rental_payments',
    'rental_ancillaries', 'rental_additional_charges', 'rental_invoices',
    'rental_invoice_line_items', 'rental_invoice_payments', 'vehicle_inspections',
    'damage_claims', 'rate_events'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'SKIP % — does not exist', t;
      CONTINUE;
    END IF;

    SELECT data_type INTO coltype
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id';

    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
      t, expr, expr
    );

    RAISE NOTICE 'ensured RLS + tenant_isolation policy on %', t;
  END LOOP;
END $$;
