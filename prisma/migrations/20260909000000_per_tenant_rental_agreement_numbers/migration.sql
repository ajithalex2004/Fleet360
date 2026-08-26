-- Fifth and last of the sequence-number cases: RA- on rental_agreements.
--
-- Same defect as REQ-/TRP-/BRK- in 20260906000000. The generator counts rows
-- with no tenant predicate:
--
--     const agreementCount = await tx.rentalAgreement.count();
--     const agreementNo = `RA-${String(agreementCount + 1).padStart(6, '0')}`;
--
-- and rental_agreements_agreement_no_key made agreement_no globally unique, so
-- the count could not simply be scoped — a per-tenant count yields a number
-- another tenant already holds.
--
-- This one was harder to see than the other four: schema.prisma does NOT mark
-- agreementNo as @unique, so the constraint is invisible from the model. It
-- only shows up by listing the indexes on the table. Worth remembering when
-- judging whether a count-based generator is safe to scope.
--
-- Safe: rental_agreements is empty, and there are zero (tenant_id,
-- agreement_no) duplicates to reconcile.
--
-- The generator is also moving from COUNT(*) to MAX(suffix), for the reason
-- given in 20260906000000: counting re-issues a number as soon as a row is
-- deleted. The composite index below rejects that rather than storing it.
--
-- Idempotent.

DROP INDEX IF EXISTS public.rental_agreements_agreement_no_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rental_agreements_tenant_agreement_no
  ON public.rental_agreements (tenant_id, agreement_no)
  WHERE agreement_no IS NOT NULL;
