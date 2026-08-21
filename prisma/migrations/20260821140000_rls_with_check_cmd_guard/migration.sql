-- Migration: 20260821140000_rls_with_check_cmd_guard
--
-- Follow-up to 20260815150000_backfill_rls_with_check.
--
-- That migration mirrors every policy's USING predicate into WITH CHECK
-- by looping over pg_policies WHERE with_check IS NULL AND qual IS NOT
-- NULL. It has no filter on `cmd`, and Postgres REJECTS WITH CHECK on
-- FOR SELECT and FOR DELETE policies:
--
--   ERROR:  WITH CHECK cannot be applied to SELECT policies
--
-- A read-only or delete-only policy therefore breaks it twice over:
--
--   1. the ALTER POLICY loop raises, aborting the migration
--   2. even if it didn't, the closing assertion would raise anyway —
--      a FOR SELECT policy ALWAYS has with_check IS NULL and qual IS
--      NOT NULL, so it counts as a permanent, unfixable "gap"
--
-- Every policy on the database this was authored against is cmd = 'ALL'
-- (248 of them), which is why it applied cleanly. But any environment
-- carrying a single FOR SELECT policy — or a fresh shadow-DB replay
-- after someone adds one — hits a migration that cannot succeed and
-- cannot be repaired by re-running.
--
-- The original file is left untouched: it is already applied, and
-- editing it would change its checksum and put every environment that
-- has run it into "migration was modified after it was applied".
--
-- This migration re-runs the same backfill with the correct filter and
-- replaces the over-broad assertion with one that only counts policies
-- that are actually capable of holding a WITH CHECK clause. On a
-- database where the original already succeeded, the loop finds nothing
-- and this is a no-op.

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
      -- WITH CHECK is only meaningful for commands that write a row.
      -- ALL / INSERT / UPDATE accept it; SELECT and DELETE reject it.
      AND  cmd IN ('ALL', 'INSERT', 'UPDATE')
    ORDER  BY schemaname, tablename, policyname
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
      r.policyname, r.schemaname, r.tablename, r.qual
    );
    RAISE NOTICE 'WITH CHECK added: %.% policy %', r.schemaname, r.tablename, r.policyname;
    fixed := fixed + 1;
  END LOOP;
  RAISE NOTICE 'cmd-guarded backfill touched % polic%',
    fixed,
    CASE WHEN fixed = 1 THEN 'y' ELSE 'ies' END;
END $$;

-- ── Assertion ────────────────────────────────────────────────────────────────
-- Same intent as the original, but scoped to policies that CAN carry a
-- WITH CHECK. Counting SELECT/DELETE policies here would make the
-- assertion permanently unsatisfiable on any database that has one.

DO $$
DECLARE
  gap_count INT;
  detail    TEXT;
BEGIN
  SELECT COUNT(*),
         string_agg(format('%s.%s[%s]', schemaname, tablename, policyname), ', ')
    INTO gap_count, detail
  FROM   pg_policies
  WHERE  with_check IS NULL
    AND  qual        IS NOT NULL
    AND  cmd IN ('ALL', 'INSERT', 'UPDATE');

  IF gap_count > 0 THEN
    -- Naming the offenders directly: the original raised a bare count,
    -- which meant hand-querying pg_policies to find out what failed.
    RAISE EXCEPTION 'RLS policies still lack WITH CHECK after backfill: % remaining (%)',
                    gap_count, detail;
  END IF;
END $$;
