-- Closes the "20260909000000" row from issue #77's audit.
--
-- 20260909000000_per_tenant_rental_agreement_numbers is already applied on
-- every real environment and is left untouched, same approach as every
-- migration in this series. Both its statements are already idempotent
-- (DROP INDEX IF EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS) — the only
-- reason it fails on a fresh replay is that rental_agreements.tenant_id
-- doesn't exist yet at this point in history, the same
-- 20260914140000/20260914150000 (#73/#74/#78) ordering gap as
-- 20260915120000 closed for the lease/rental children. Verbatim re-run,
-- safe no-op on every real environment.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260909000000_per_tenant_rental_agreement_numbers

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'rental_agreements' AND column_name = 'tenant_id'
  ) THEN
    RAISE NOTICE 'SKIP — rental_agreements.tenant_id does not exist yet (should not happen this late in migration order — investigate if seen)';
    RETURN;
  END IF;

  DROP INDEX IF EXISTS public.rental_agreements_agreement_no_key;

  CREATE UNIQUE INDEX IF NOT EXISTS uniq_rental_agreements_tenant_agreement_no
    ON public.rental_agreements (tenant_id, agreement_no)
    WHERE agreement_no IS NOT NULL;
END $$;
