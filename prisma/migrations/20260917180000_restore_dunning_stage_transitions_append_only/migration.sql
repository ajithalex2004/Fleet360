-- 20260911180000_dunning_collections_workflow deliberately revoked UPDATE
-- and DELETE on lease_dunning_stage_transitions from fleet360_app to make
-- the table append-only (it's a dunning-stage audit trail; the application
-- must only ever be able to insert new transitions, never rewrite or erase
-- history). 20260915260000_fresh_replay_grant_app_role_public_schema, four
-- days later, ran a blanket
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fleet360_app
-- with no carve-out for this table, silently re-granting UPDATE/DELETE and
-- undoing the append-only guarantee. This surfaced when production was
-- brought current on 2026-09-17 (see docs/KNOWN_GAPS.md OPS-001) and CI's
-- "append-only enforcement" test (tests/integration/dunning-collections-
-- postgres.test.ts) immediately caught the regression.
--
-- Compare _prisma_migrations' own REVOKE in
-- 20260915280000_fresh_replay_lease_allocation_occurrences, which runs
-- *after* 20260915260000's blanket grant and so was never clobbered — this
-- table's REVOKE predates it and got silently overwritten. Re-applying here
-- rather than editing either historical migration in place, since both are
-- already recorded as applied (with checksums) on real environments.
--
-- Idempotent / safe to re-run: REVOKE on a role that already lacks the
-- privilege is a no-op, not an error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lease_dunning_stage_transitions'
  ) THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON public.lease_dunning_stage_transitions FROM fleet360_app';
  END IF;
END $$;
