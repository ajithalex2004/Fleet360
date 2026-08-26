-- finance_invoices: quarantine the 17 test rows, then constrain the column.
--
-- These were the last real business-data risk before the runtime-role switch:
-- 18 rows, 17 with no tenant, carrying invoice_number, client_name and amounts,
-- readable by every tenant through the policy's NULL branch. 20260910000006
-- removed that branch, so they are already platform-only; what remains is that
-- the column is still nullable, which keeps the door open for the next
-- untenanted insert.
--
-- PROVENANCE, established before touching anything. Every attribution avenue
-- was checked and all of them agree these are test fixtures:
--
--   client_name          "RBAC Test Client" (x5), "Test Client Ltd" (x9),
--                        "ID Isolation Test" (x2), "Isolation Test Client" (x1)
--   created_at           two bursts on 2026-04-30, 15:56-15:57 and 16:54-16:55,
--                        individual rows seconds apart — automated runs, not
--                        human data entry
--   created_by           empty on all 17
--   source_payload       '{}' on all 17; every other source_* column empty
--   reference_id/_type   empty on all 17
--   inbound FKs          none declared
--   finance_payments     0 rows reference any of them
--   customer tables      no tenant-owned customer matches any of the 4 names
--   audit_logs           0 entries, admin_change_history 0 entries
--
-- The names are not merely suggestive — "ID Isolation Test" and "Isolation Test
-- Client" name the exact activity this migration series is part of.
--
-- QUARANTINE RATHER THAN DELETE. The rows are copied to
-- finance.zz_quarantine_finance_invoices_20260910 first, so this is reversible
-- if the provenance reading turns out to be wrong. Deleting 17 rows on the
-- strength of a naming convention should not be a one-way door.
--
-- The quarantine table is given RLS with no NULL branch, so its contents are
-- reachable only under withPlatformAdmin — quarantining data must not reopen
-- the exposure being closed. Its tenant_id stays nullable by necessity (every
-- value in it is NULL), which is why it needs the policy rather than a
-- constraint.
--
-- NOT DELETED: the single tenanted invoice, which belongs to a tenant whose id
-- begins `debug-te`. It is scoped correctly and outside this migration's remit
-- even if it is also test data.
--
-- Idempotent.

DO $$
DECLARE
  moved bigint;
  remaining bigint;
BEGIN
  -- 1. Quarantine, once.
  IF to_regclass('finance.zz_quarantine_finance_invoices_20260910') IS NULL THEN
    CREATE TABLE finance.zz_quarantine_finance_invoices_20260910 AS
      SELECT * FROM finance.finance_invoices WHERE tenant_id IS NULL;

    GET DIAGNOSTICS moved = ROW_COUNT;
    RAISE NOTICE 'quarantined % NULL-tenant invoice row(s)', moved;

    -- The copy carries a tenant_id column full of NULLs, so it would be a new
    -- unprotected tenant-bearing table if left alone. Policy without the NULL
    -- branch = platform-only.
    ALTER TABLE finance.zz_quarantine_finance_invoices_20260910
      ENABLE ROW LEVEL SECURITY;
    ALTER TABLE finance.zz_quarantine_finance_invoices_20260910
      FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation
      ON finance.zz_quarantine_finance_invoices_20260910
      FOR ALL
      USING (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id = current_setting('app.tenant_id', true)
      )
      WITH CHECK (
        current_setting('app.tenant_id', true) = '*'
        OR tenant_id = current_setting('app.tenant_id', true)
      );
  ELSE
    RAISE NOTICE 'quarantine table already exists — not re-copying';
  END IF;

  -- 2. Remove them from the live table.
  DELETE FROM finance.finance_invoices WHERE tenant_id IS NULL;
  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'deleted % NULL-tenant row(s) from finance.finance_invoices', moved;

  -- 3. Constrain, now that there is nothing left to constrain around.
  SELECT count(*) INTO remaining FROM finance.finance_invoices WHERE tenant_id IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'finance.finance_invoices still has % NULL-tenant row(s)', remaining;
  END IF;

  ALTER TABLE finance.finance_invoices ALTER COLUMN tenant_id SET NOT NULL;
END $$;

-- Verify: nothing untenanted left, the column is constrained, and the
-- quarantine copy holds exactly what was removed and is not tenant-readable.
DO $$
DECLARE
  live_nulls  bigint;
  nullable    text;
  quarantined bigint;
  q_open      boolean;
BEGIN
  SELECT count(*) INTO live_nulls FROM finance.finance_invoices WHERE tenant_id IS NULL;
  IF live_nulls > 0 THEN
    RAISE EXCEPTION 'verification failed: % NULL-tenant invoices remain', live_nulls;
  END IF;

  SELECT is_nullable INTO nullable FROM information_schema.columns
   WHERE table_schema='finance' AND table_name='finance_invoices' AND column_name='tenant_id';
  IF nullable <> 'NO' THEN
    RAISE EXCEPTION 'verification failed: finance_invoices.tenant_id is still nullable';
  END IF;

  SELECT count(*) INTO quarantined FROM finance.zz_quarantine_finance_invoices_20260910;
  IF quarantined <> 17 THEN
    RAISE NOTICE 'quarantine holds % rows (expected 17 at the time of writing)', quarantined;
  END IF;

  SELECT NOT (c.relrowsecurity AND c.relforcerowsecurity
              AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
    INTO q_open
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='finance' AND c.relname='zz_quarantine_finance_invoices_20260910';
  IF q_open THEN
    RAISE EXCEPTION 'verification failed: the quarantine table is not protected';
  END IF;
END $$;
