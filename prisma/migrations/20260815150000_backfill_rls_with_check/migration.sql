-- Migration: 20260815150000_backfill_rls_with_check
--
-- Backfills WITH CHECK on every existing RLS policy that has USING
-- but no WITH CHECK. Complements the tenant-001 hardening on the
-- fix/tenant-001-isolation branch with a codebase-wide sweep for the
-- same defect elsewhere.
--
-- Why WITH CHECK is required alongside USING:
--   USING      — gates read visibility (SELECT filter)
--   WITH CHECK — gates writes (INSERT / UPDATE new-row predicate)
--
-- Without WITH CHECK, a session can INSERT a row with tenant_id
-- pointing at another tenant, or UPDATE tenant_id to change
-- ownership. USING blocks the session from ever SELECTing the row
-- back, but the row was still written. Application code should
-- prevent this too, but the DB is the last line of defence.
--
-- Discovery-based, not hardcoded: reads pg_policies at runtime and
-- mirrors each `qual` (USING expression) into a new WITH CHECK
-- clause via ALTER POLICY. Advantages:
--   1. Idempotent — a second run finds zero rows to update because
--      the policies now have with_check set.
--   2. Catches every current gap without listing them.
--   3. Catches any future policy created with USING alone.
--   4. Preserves the exact USING predicate — no risk of a hand-typed
--      predicate drifting from the intended semantics.
--
-- Predicate parity, not tightening:
--   The mirrored WITH CHECK uses the SAME predicate as USING.
--   If a USING allows cross-tenant reads via `tenant_id IS NULL` or
--   `current_setting('app.tenant_id') = '*'` branches, the WITH
--   CHECK will allow the same for writes. This is intentional —
--   parity matters more during rollout than tightening in one
--   direction only. Tighten a specific policy later if it needs
--   different read/write semantics (e.g. admin sessions can read
--   everything but only write to their own tenant).

DO $$
DECLARE
  r      RECORD;
  fixed  INT := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual
    FROM   pg_policies
    WHERE  with_check IS NULL
      AND  qual        IS NOT NULL
    ORDER  BY schemaname, tablename, policyname
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
      r.policyname, r.schemaname, r.tablename, r.qual
    );
    RAISE NOTICE 'WITH CHECK added: %.% policy %', r.schemaname, r.tablename, r.policyname;
    fixed := fixed + 1;
  END LOOP;
  RAISE NOTICE 'Backfilled WITH CHECK on % polic%',
    fixed,
    CASE WHEN fixed = 1 THEN 'y' ELSE 'ies' END;
END $$;

-- ── Assertion ────────────────────────────────────────────────────────────────
-- After this migration, every RLS policy with USING must also have WITH CHECK.
-- Fails hard if any leaked through — either a policy created concurrently with
-- USING-only, or an edge case the discovery loop missed.

DO $$
DECLARE
  gap_count INT;
BEGIN
  SELECT COUNT(*) INTO gap_count
  FROM   pg_policies
  WHERE  with_check IS NULL
    AND  qual        IS NOT NULL;

  IF gap_count > 0 THEN
    RAISE EXCEPTION 'RLS policies still lack WITH CHECK after backfill: % remaining. '
                    'Query pg_policies WHERE with_check IS NULL to inspect.',
                    gap_count;
  END IF;
END $$;

-- ── Follow-up (out of scope for this migration) ─────────────────────────────
--
-- Historical migration files that create policies with USING-only remain
-- unchanged (immutable migrations). Their post-apply state is now fixed by
-- this migration, so a fresh shadow-DB replay lands correctly:
--
--   1. Old migration N       creates policy without WITH CHECK
--   2. This migration N+M    ALTERs it to add WITH CHECK
--
-- For NEW migrations going forward, always author policies with both
-- clauses inline — don't rely on this backfill to catch them.
