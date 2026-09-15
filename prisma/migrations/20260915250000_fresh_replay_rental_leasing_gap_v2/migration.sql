-- Closes a second fresh-replay gap in 20260914140000_fresh_replay_rental_leasing_gap
-- (PR #78, already merged and applied on every real environment — left
-- untouched, same approach as every migration in this series). Found while
-- walking issue #77's remaining catalogued items end-to-end through a
-- genuinely empty database for the first time; PR #78's own testing used
-- the same resolve-shortcut technique this series relies on throughout, but
-- apparently never chained all the way through a truly fresh replay, so
-- this didn't surface until now.
--
-- This migration was reached via `npx prisma migrate resolve --applied
-- 20260914140000...` (bookkeeping only, per this series' established
-- pattern for a broken original) after its Part 2 failed on a fresh
-- replay — which means Part 1 (five untracked tables: rental_rate_quotes,
-- rental_vehicle_exchanges, rental_invoices, rental_invoice_line_items,
-- rental_invoice_payments, all created inside the SAME failed transaction
-- and rolled back along with everything else) never actually ran either.
-- Reproduced verbatim first, below, before the corrected Parts 2 and 3 —
-- otherwise those five tables would be silently missing from a fresh
-- replay. Two of them (rental_vehicle_exchanges, rental_invoices) already
-- declare tenant_id NOT NULL directly in their CREATE TABLE, so Part 2's
-- backfill is a guaranteed no-op for those specifically — the real target
-- of Part 2's gap is the other three (rental_extensions, rental_payments,
-- rental_additional_charges), which come from 20260904000000 instead.
--
-- Part 2 of that migration backfills tenant_id on five rental child tables
-- (rental_extensions, rental_payments, rental_additional_charges,
-- rental_vehicle_exchanges, rental_invoices) by joining through
-- rental_agreements. The UPDATE statements have a row-level guard
-- (`WHERE x.tenant_id IS NULL`) but no column-existence guard — on a fresh
-- replay, none of these five have a tenant_id column yet at this point:
-- that column is added by 20260904000000's own 11-table loop, which has its
-- OWN fresh-replay gap, fixed elsewhere in this series by
-- 20260915120000_fresh_replay_lease_rental_children_rls — dated after this
-- file, same "a later fix supplies what an earlier migration needs" shape
-- as the bookings/logistics_shipment_orders and finance_security_deposits
-- gaps already closed in this series.
--
-- Part 3 (RLS for 19 tables) has a table-existence guard but the same
-- missing column-existence guard — CREATE POLICY validates that its USING/
-- WITH CHECK expressions reference real columns, so it would fail the same
-- way for the same five tables once Part 2 is no longer the first thing to
-- fail.
--
-- Fix: guard both parts on tenant_id's existence, per table. Skipping is
-- safe — 20260915120000 adds tenant_id AND enables RLS with a
-- tenant_isolation policy for all five of these tables (among its 11)
-- later in this same chain, so the end state is identical either way, just
-- reached by a different migration. Safe no-op on every real environment,
-- where all five already have tenant_id and RLS.
--
-- A fresh database needs the same manual step 20260914140000 itself would
-- have documented had it anticipated this:
--   npx prisma migrate resolve --applied 20260914140000_fresh_replay_rental_leasing_gap
-- Its Part 1 (five untracked tables) is reproduced verbatim above for
-- exactly this reason — that resolve step means Part 1 never ran either,
-- not just Part 2.

-- ═══════════════════════════════════════════════════════════════════════════
-- Part 1 (verbatim) — the five untracked tables, exact live DDL.
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
-- Part 2 (corrected) — same backfill, each statement individually guarded
-- on tenant_id existing on that specific table.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  targets text[] := ARRAY['rental_extensions', 'rental_payments', 'rental_additional_charges', 'rental_vehicle_exchanges', 'rental_invoices'];
  cols    text[] := ARRAY['agreement_id', 'agreement_id', 'agreement_id', 'agreement_id', 'agreement_id'];
  t text;
  fk text;
  i int;
  n bigint;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    t := targets[i];
    fk := cols[i];

    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'SKIP % backfill — table does not exist', t;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      RAISE NOTICE 'SKIP % backfill — no tenant_id column yet; covered later by 20260915120000_fresh_replay_lease_rental_children_rls', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'UPDATE public.%I x SET tenant_id = a.tenant_id FROM public.rental_agreements a WHERE x.%I = a.id AND x.tenant_id IS NULL',
      t, fk);
  END LOOP;

  -- Verification, scoped to whichever of the five actually have the column
  -- (mirrors the guards above — a table skipped for lacking the column
  -- can't meaningfully be checked for NULL tenant_id in it either).
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.rental_extensions WHERE tenant_id IS NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rental_extensions' AND column_name='tenant_id')
    UNION ALL
    SELECT 1 FROM public.rental_payments WHERE tenant_id IS NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rental_payments' AND column_name='tenant_id')
    UNION ALL
    SELECT 1 FROM public.rental_additional_charges WHERE tenant_id IS NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rental_additional_charges' AND column_name='tenant_id')
    UNION ALL
    SELECT 1 FROM public.rental_vehicle_exchanges WHERE tenant_id IS NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rental_vehicle_exchanges' AND column_name='tenant_id')
    UNION ALL
    SELECT 1 FROM public.rental_invoices WHERE tenant_id IS NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rental_invoices' AND column_name='tenant_id')
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION 'issue #73 backfill: % rows still have NULL tenant_id after the corrected join — orphaned from rental_agreements, needs manual review', n;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Part 3 (corrected) — same 19-table RLS loop, with a column-existence
-- guard added alongside the table-existence one it already had.
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

    IF coltype IS NULL THEN
      RAISE NOTICE 'SKIP % — no tenant_id column yet', t;
      CONTINUE;
    END IF;

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
