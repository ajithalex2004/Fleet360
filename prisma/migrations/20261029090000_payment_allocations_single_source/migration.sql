-- Payment allocations are the single source of an invoice's paid amount.
--
-- finance_invoices.paid_amount had two writers. POST /api/finance/payments
-- and PATCH /api/finance/invoices/[id] (record_payment) added the payment to
-- paid_amount directly and wrote no allocation; the trigger on
-- finance_payment_allocations (20261008090000) sets paid_amount to the SUM of
-- allocations. The first allocation on an invoice therefore erased every
-- payment recorded the direct way, and the invoice could show unpaid again.
--
-- From this release both routes write an allocation and leave paid_amount to
-- the trigger. This migration:
--
--   1. Rewrites the trigger function so invoices use the finance invoice
--      statuses (PARTIAL, PAID; back to SENT when nothing is allocated). It
--      wrote PARTIALLY_PAID and UNPAID, which the finance screens and the
--      collections query (SENT / PARTIAL / OVERDUE) do not know: a partly
--      allocated invoice dropped out of collections. Payables keep their own
--      statuses (UNPAID / PARTIALLY_PAID / PAID).
--   2. Backfills one allocation for every existing payment tied to an invoice
--      that has none, so those payments count from now on (and invoices whose
--      direct payments an allocation already erased are repaired).
--
-- Safe to re-run.

SELECT set_config('app.tenant_id', '*', false);

-- ── 1. trigger function ──────────────────────────────────────────────────
DO $$
DECLARE
  allocs   regclass := COALESCE(to_regclass('public.' || 'finance_payment_allocations'), to_regclass('finance.' || 'finance_payment_allocations'));
  invoices regclass := COALESCE(to_regclass('public.' || 'finance_invoices'), to_regclass('finance.' || 'finance_invoices'));
  payables regclass := COALESCE(to_regclass('public.' || 'finance_payables'), to_regclass('finance.' || 'finance_payables'));
  body text;
BEGIN
  IF allocs IS NULL OR invoices IS NULL OR payables IS NULL THEN
    RETURN;
  END IF;

  body := format(
    'DECLARE
       v_invoice_id UUID;
       v_payable_id UUID;
       v_total      NUMERIC(14,2);
       v_paid       NUMERIC(14,2);
     BEGIN
       IF TG_OP = ''DELETE'' THEN
         v_invoice_id := OLD.invoice_id;
         v_payable_id := OLD.payable_id;
       ELSE
         v_invoice_id := NEW.invoice_id;
         v_payable_id := NEW.payable_id;
       END IF;

       IF v_invoice_id IS NOT NULL THEN
         SELECT COALESCE(SUM(allocated_amount), 0) INTO v_paid FROM %1$s WHERE invoice_id = v_invoice_id;
         SELECT total_amount INTO v_total FROM %2$s WHERE id = v_invoice_id;
         UPDATE %2$s
            SET paid_amount = v_paid,
                payment_status = CASE
                  -- A cancelled invoice stays cancelled; its paid_amount still
                  -- follows its allocations.
                  WHEN payment_status = ''CANCELLED'' THEN ''CANCELLED''
                  WHEN v_paid >= COALESCE(v_total, 0) AND v_paid > 0 THEN ''PAID''
                  WHEN v_paid > 0 THEN ''PARTIAL''
                  -- Nothing allocated: an invoice the allocations had marked
                  -- paid goes back to SENT; DRAFT / OVERDUE / CANCELLED stay.
                  WHEN payment_status IN (''PAID'', ''PARTIAL'', ''PARTIALLY_PAID'', ''UNPAID'') THEN ''SENT''
                  ELSE payment_status END,
                updated_at = NOW()
          WHERE id = v_invoice_id;
       END IF;

       IF v_payable_id IS NOT NULL THEN
         SELECT COALESCE(SUM(allocated_amount), 0) INTO v_paid FROM %1$s WHERE payable_id = v_payable_id;
         SELECT total_amount INTO v_total FROM %3$s WHERE id = v_payable_id;
         UPDATE %3$s
            SET paid_amount = v_paid,
                payment_status = CASE
                  WHEN v_paid <= 0 THEN ''UNPAID''
                  WHEN v_paid >= COALESCE(v_total, 0) THEN ''PAID''
                  ELSE ''PARTIALLY_PAID'' END,
                updated_at = NOW()
          WHERE id = v_payable_id;
       END IF;

       RETURN NULL;
     END', allocs, invoices, payables);

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION finance.fn_sync_alloc_paid_amount() RETURNS TRIGGER LANGUAGE plpgsql AS %L',
    body);
END $$;

-- An invoice the old function had set to PARTIALLY_PAID / UNPAID gets the
-- finance status for what is allocated to it.
DO $$
DECLARE
  allocs   regclass := COALESCE(to_regclass('public.' || 'finance_payment_allocations'), to_regclass('finance.' || 'finance_payment_allocations'));
  invoices regclass := COALESCE(to_regclass('public.' || 'finance_invoices'), to_regclass('finance.' || 'finance_invoices'));
BEGIN
  IF allocs IS NULL OR invoices IS NULL THEN
    RETURN;
  END IF;
  EXECUTE format(
    'UPDATE %1$s i
        SET payment_status = CASE WHEN i.paid_amount > 0 THEN ''PARTIAL'' ELSE ''SENT'' END,
            updated_at = NOW()
      WHERE i.payment_status IN (''PARTIALLY_PAID'', ''UNPAID'')', invoices);
END $$;

-- ── 2. backfill allocations for direct payments ──────────────────────────
-- Each insert fires the trigger, which recomputes the invoice's paid amount
-- from all of its allocations.
DO $$
DECLARE
  allocs   regclass := COALESCE(to_regclass('public.' || 'finance_payment_allocations'), to_regclass('finance.' || 'finance_payment_allocations'));
  payments regclass := COALESCE(to_regclass('public.' || 'finance_payments'), to_regclass('finance.' || 'finance_payments'));
BEGIN
  IF allocs IS NULL OR payments IS NULL THEN
    RETURN;
  END IF;
  EXECUTE format(
    'INSERT INTO %1$s (payment_id, invoice_id, allocated_amount, allocation_date, notes, allocated_by, tenant_id)
     SELECT p.id, p.invoice_id, p.amount, COALESCE(p.payment_date, CURRENT_DATE),
            ''Backfill: payment recorded against the invoice directly'', ''migration'', p.tenant_id
       FROM %2$s p
      WHERE p.invoice_id IS NOT NULL
        AND p.amount > 0
        AND NOT EXISTS (SELECT 1 FROM %1$s a WHERE a.payment_id = p.id)', allocs, payments);
END $$;

SELECT set_config('app.tenant_id', '', false);
