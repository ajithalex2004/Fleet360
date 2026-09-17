-- Migration: 20260915290000_fresh_replay_drop_finance_payments_shadow
--
-- Drops public.finance_payments, an empty duplicate shadow table accidentally
-- recreated in public by 20260910000026_finance_payments_table_and_rls.
--
-- The canonical, tenant-isolated table is finance.finance_payments.
-- Having public.finance_payments shadows finance.finance_payments on unqualified
-- references, violating tenant isolation invariants.

DO $$
BEGIN
  IF to_regclass('public.finance_payments') IS NOT NULL THEN
    DROP TABLE public.finance_payments;
    RAISE NOTICE 'dropped public.finance_payments shadow table';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    ALTER ROLE fleet360_app SET search_path = "$user", public, finance, ai, fleet, operations, spatial, workforce;
    RAISE NOTICE 'configured search_path for fleet360_app';
  END IF;
END $$;
