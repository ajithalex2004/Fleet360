-- Closes the "20260910000016" row from issue #77's audit.
--
-- 20260910000016_finance_deposits_recurring_tables_and_rls is already
-- applied on every real environment and is left untouched, same approach as
-- every migration in this series. Unlike every other item in this series,
-- this one is not fresh-replay-only: it is broken on EVERY environment,
-- including live, in the sense that its own CREATE TABLE for
-- finance_security_deposits could never actually succeed as written.
--
-- held_days is declared GENERATED ALWAYS AS (... CURRENT_DATE ...) STORED.
-- CURRENT_DATE is not immutable (Postgres requires a generation expression's
-- immutability, and CURRENT_DATE depends on the current transaction), so
-- Postgres rejects the column definition outright with 42P17 the moment it
-- actually has to create it. Confirmed live has no held_days column at all
-- on public.finance_security_deposits — this was never silently worked
-- around at runtime, it simply never ran: the table already existed via the
-- untracked legacy path (same pattern as elsewhere in this series) before
-- this migration first executed, so CREATE TABLE IF NOT EXISTS skipped the
-- whole statement, generated column and all, without ever attempting it.
-- The other two tables in this file, finance_recurring_schedules and
-- finance_recurring_log, have no such bug in their own generated columns
-- (ROUND()-based, both immutable) — but they too already existed live
-- before this migration ran, with a handful of columns
-- (finance_security_deposits: reserved_amount, refund_status,
-- refund_requested_amount/by/at, refund_recorded_by/at, refunded_amount)
-- and an already-NOT-NULL tenant_id that the tracked migration doesn't
-- mention creating either — the same "this migration only ever ran against
-- an already-conforming table" story as everywhere else in this series, not
-- specific to the held_days bug.
--
-- On a fresh replay none of the three tables exist yet, so the CREATE TABLE
-- statements actually execute, and finance_security_deposits's fails
-- outright regardless of ordering or existence guards — this is a defect in
-- the statement itself, not a sequencing problem.
--
-- Fix: recreate all three tables with their exact live DDL (pg_dump'd from
-- production) — held_days simply isn't part of it, since it isn't part of
-- live either. Safe no-op on every real environment, where all three tables
-- already exist in this exact shape.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260910000016_finance_deposits_recurring_tables_and_rls

CREATE TABLE IF NOT EXISTS public.finance_recurring_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    schedule_no text NOT NULL,
    contract_id text NOT NULL,
    contract_type text DEFAULT 'LEASE'::text NOT NULL,
    customer_name text NOT NULL,
    customer_trn text,
    vehicle_no text NOT NULL,
    branch text DEFAULT 'Dubai'::text NOT NULL,
    billing_cycle text DEFAULT 'MONTHLY'::text NOT NULL,
    amount numeric(14,2) NOT NULL,
    vat_rate numeric(5,2) DEFAULT 5 NOT NULL,
    vat_amount numeric(14,2) GENERATED ALWAYS AS (round(((amount * vat_rate) / (100)::numeric), 2)) STORED,
    grand_total numeric(14,2) GENERATED ALWAYS AS ((amount + round(((amount * vat_rate) / (100)::numeric), 2))) STORED,
    start_date date NOT NULL,
    end_date date,
    next_invoice_date date NOT NULL,
    last_invoice_date date,
    invoices_generated integer DEFAULT 0 NOT NULL,
    auto_approve boolean DEFAULT false NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    description text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text NOT NULL,
    CONSTRAINT finance_recurring_schedules_schedule_no_key UNIQUE (schedule_no)
);
CREATE INDEX IF NOT EXISTS idx_frs_next_date ON public.finance_recurring_schedules USING btree (next_invoice_date);
CREATE INDEX IF NOT EXISTS idx_frs_status ON public.finance_recurring_schedules USING btree (status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_recurring_schedules TO fleet360_app;
ALTER TABLE public.finance_recurring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_recurring_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.finance_recurring_schedules;
CREATE POLICY tenant_isolation ON public.finance_recurring_schedules FOR ALL
  USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE IF NOT EXISTS public.finance_recurring_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    schedule_id uuid NOT NULL,
    invoice_id text,
    invoice_no text,
    period_start date NOT NULL,
    period_end date NOT NULL,
    amount numeric(14,2) NOT NULL,
    vat_amount numeric(14,2) NOT NULL,
    grand_total numeric(14,2) NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    triggered_by text DEFAULT 'MANUAL'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id text NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finance_recurring_log_schedule_id_fkey'
  ) THEN
    ALTER TABLE public.finance_recurring_log
      ADD CONSTRAINT finance_recurring_log_schedule_id_fkey
      FOREIGN KEY (schedule_id) REFERENCES public.finance_recurring_schedules(id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_frl_schedule ON public.finance_recurring_log USING btree (schedule_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_recurring_log TO fleet360_app;
ALTER TABLE public.finance_recurring_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_recurring_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.finance_recurring_log;
CREATE POLICY tenant_isolation ON public.finance_recurring_log FOR ALL
  USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

-- No held_days — see comment above; it is not part of live's shape.
CREATE TABLE IF NOT EXISTS public.finance_security_deposits (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    deposit_no text NOT NULL,
    contract_id text NOT NULL,
    contract_type text DEFAULT 'LEASE'::text NOT NULL,
    customer_name text NOT NULL,
    customer_trn text,
    vehicle_no text NOT NULL,
    vehicle_type text,
    branch text DEFAULT 'Dubai'::text NOT NULL,
    collected_amount numeric(14,2) DEFAULT 0 NOT NULL,
    collection_date date NOT NULL,
    collection_method text DEFAULT 'BANK_TRANSFER'::text NOT NULL,
    cheque_no text,
    bank_name text,
    status text DEFAULT 'HELD'::text NOT NULL,
    deductions jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_deducted numeric(14,2) DEFAULT 0 NOT NULL,
    refund_amount numeric(14,2),
    refund_date date,
    refund_method text,
    refund_reference text,
    forfeiture_reason text,
    notes text,
    tenant_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reserved_amount numeric(14,2) DEFAULT 0 NOT NULL,
    refund_status text,
    refund_requested_amount numeric(14,2),
    refund_requested_by text,
    refund_requested_at timestamp(6) with time zone,
    refund_recorded_by text,
    refund_recorded_at timestamp(6) with time zone,
    refunded_amount numeric(14,2) DEFAULT 0 NOT NULL,
    CONSTRAINT finance_security_deposits_deposit_no_key UNIQUE (deposit_no)
);
CREATE INDEX IF NOT EXISTS idx_fsd_contract ON public.finance_security_deposits USING btree (contract_id);
CREATE INDEX IF NOT EXISTS idx_fsd_status ON public.finance_security_deposits USING btree (status);
CREATE INDEX IF NOT EXISTS idx_fsd_branch ON public.finance_security_deposits USING btree (branch);
CREATE INDEX IF NOT EXISTS idx_finance_security_deposits_tenant_id ON public.finance_security_deposits USING btree (tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_security_deposits TO fleet360_app;
ALTER TABLE public.finance_security_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_security_deposits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.finance_security_deposits;
CREATE POLICY tenant_isolation ON public.finance_security_deposits FOR ALL
  USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));
