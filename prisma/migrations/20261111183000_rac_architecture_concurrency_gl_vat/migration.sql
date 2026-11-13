-- ============================================================================
-- RAC Architecture Unification, Cross-Module Concurrency, CoA GL & UAE VAT
-- ============================================================================

-- 1. Catch-up columns on VehicleInspection, TrafficFine & TollTransaction
ALTER TABLE IF EXISTS public.vehicle_inspections ADD COLUMN IF NOT EXISTS condition_grade TEXT;

ALTER TABLE IF EXISTS public.traffic_fines ADD COLUMN IF NOT EXISTS rental_agreement_id TEXT;
ALTER TABLE IF EXISTS public.traffic_fines ADD COLUMN IF NOT EXISTS admin_fee NUMERIC(10,2) DEFAULT 0;
ALTER TABLE IF EXISTS public.traffic_fines ADD COLUMN IF NOT EXISTS knowledge_fee NUMERIC(10,2) DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_traffic_fines_rental_agreement_id
  ON public.traffic_fines (rental_agreement_id)
  WHERE rental_agreement_id IS NOT NULL;

ALTER TABLE IF EXISTS public.toll_transactions ADD COLUMN IF NOT EXISTS admin_fee NUMERIC(10,2) DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_toll_transactions_rental_agreement
  ON public.toll_transactions (rental_agreement_id)
  WHERE rental_agreement_id IS NOT NULL;

-- 2. Relax rental_vehicle_transfers fuel_level check constraint to canonical 0..100%
DO $$
BEGIN
  IF to_regclass('public.rental_vehicle_transfers') IS NOT NULL THEN
    ALTER TABLE public.rental_vehicle_transfers
      DROP CONSTRAINT IF EXISTS rental_vehicle_transfers_fuel_level_check;
    ALTER TABLE public.rental_vehicle_transfers
      ADD CONSTRAINT rental_vehicle_transfers_fuel_level_check
      CHECK (fuel_level IS NULL OR (fuel_level BETWEEN 0 AND 100));
  END IF;
END $$;

-- 3. Backfill orphaned legacy rental_renewals rows into canonical rental_extensions
DO $$
BEGIN
  IF to_regclass('public.rental_renewals') IS NOT NULL
     AND to_regclass('public.rental_extensions') IS NOT NULL
     AND to_regclass('public.rental_agreements') IS NOT NULL THEN
    PERFORM set_config('app.tenant_id', '*', true);

    INSERT INTO public.rental_extensions (
      id,
      created_at,
      updated_at,
      tenant_id,
      agreement_id,
      renewal_no,
      original_end_date,
      new_end_date,
      extra_days,
      daily_rate,
      extra_amount,
      vat_amount,
      total_amount,
      deposit_top_up,
      reason,
      approved_by,
      approved_at,
      status,
      notes
    )
    SELECT
      rr.id::text,
      COALESCE(rr.created_at, NOW()),
      COALESCE(rr.updated_at, NOW()),
      rr.tenant_id,
      rr.agreement_id,
      rr.renewal_no,
      COALESCE(rr.original_end_date::timestamptz, ra.end_date),
      COALESCE(rr.new_end_date::timestamptz, ra.end_date),
      COALESCE(rr.extension_days, 1),
      rr.daily_rate,
      rr.renewal_amount,
      COALESCE(rr.vat_amount, 0),
      rr.total_amount,
      COALESCE(rr.deposit_top_up, 0),
      rr.notes,
      rr.approved_by,
      rr.approved_at,
      COALESCE(rr.status, 'PENDING'),
      rr.notes
    FROM public.rental_renewals rr
    JOIN public.rental_agreements ra
      ON ra.id::text = rr.agreement_id::text
     AND ra.tenant_id::text = rr.tenant_id::text
    WHERE rr.deleted_at IS NULL
      AND rr.agreement_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
          FROM public.rental_extensions re
         WHERE re.id::text = rr.id::text
            OR (
              rr.renewal_no IS NOT NULL
              AND re.tenant_id::text = rr.tenant_id::text
              AND re.renewal_no = rr.renewal_no
            )
      )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 4. Convert global finance_invoices & finance_security_deposits unique constraints to per-tenant
DO $$
DECLARE
  v_sch TEXT;
  v_rel REGCLASS;
BEGIN
  FOREACH v_sch IN ARRAY ARRAY['public', 'finance'] LOOP
    v_rel := to_regclass(v_sch || '.finance_invoices');
    IF v_rel IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.finance_invoices DROP CONSTRAINT IF EXISTS finance_invoices_invoice_number_key', v_sch);
      EXECUTE format('DROP INDEX IF EXISTS %I.finance_invoices_invoice_number_key', v_sch);

      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_invoices_tenant_invoice_no ' ||
        'ON %I.finance_invoices (tenant_id, invoice_number) ' ||
        'WHERE deleted_at IS NULL',
        v_sch
      );

      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_invoices_tenant_source ' ||
        'ON %I.finance_invoices (tenant_id, module_source, reference_type, (reference_id::text)) ' ||
        'WHERE deleted_at IS NULL AND module_source IS NOT NULL AND reference_type IS NOT NULL AND reference_id IS NOT NULL',
        v_sch
      );
    END IF;
  END LOOP;

  IF to_regclass('public.finance_security_deposits') IS NOT NULL THEN
    ALTER TABLE public.finance_security_deposits
      DROP CONSTRAINT IF EXISTS finance_security_deposits_deposit_no_key;
    DROP INDEX IF EXISTS public.finance_security_deposits_deposit_no_key;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_security_deposits_tenant_no
      ON public.finance_security_deposits (tenant_id, deposit_no);
  END IF;
END $$;

-- 5. Seed RAC Fine/Toll Clearing (2160) & Admin Surcharge Income (4140) into CoA template + existing tenants
DO $$
BEGIN
  IF to_regclass('finance.finance_coa_template') IS NOT NULL THEN
    INSERT INTO finance.finance_coa_template
      (account_code, account_name, account_type, account_subtype, parent_code,
       description, is_header, is_active, is_system, normal_balance, sort_order)
    VALUES
      ('2160', 'Traffic Fines & Tolls Clearing', 'LIABILITY', 'CURRENT', '2100',
       'Non-taxable statutory RTA/Police fines and Salik/Darb pass-through clearing (FTA VATP006/VATP040)',
       FALSE, TRUE, FALSE, 'CREDIT', 49),
      ('4140', 'RAC — Fine & Toll Admin Surcharges', 'INCOME', 'REVENUE', '4100',
       '5% VAT-taxable administrative handling surcharges on RAC traffic fines and tolls',
       FALSE, TRUE, FALSE, 'CREDIT', 74)
    ON CONFLICT (account_code) DO NOTHING;
  END IF;

  IF to_regclass('finance.finance_chart_of_accounts') IS NOT NULL
     AND to_regclass('public.tenants') IS NOT NULL THEN
    PERFORM set_config('app.tenant_id', '*', true);

    INSERT INTO finance.finance_chart_of_accounts
      (tenant_id, account_code, account_name, account_type, account_subtype, parent_code,
       description, is_header, is_active, is_system, normal_balance, currency, sort_order)
    SELECT
      tn.id::text,
      tp.account_code,
      tp.account_name,
      tp.account_type,
      tp.account_subtype,
      tp.parent_code,
      tp.description,
      tp.is_header,
      tp.is_active,
      tp.is_system,
      tp.normal_balance,
      tp.currency,
      tp.sort_order
    FROM public.tenants tn
    CROSS JOIN finance.finance_coa_template tp
    WHERE tp.account_code IN ('2160', '4140')
    ON CONFLICT (tenant_id, account_code) DO NOTHING;
  END IF;
END $$;
