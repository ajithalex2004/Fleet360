-- ============================================================
-- Add FK constraints for lease_contracts_v2.opening_branch_id and
-- lease_contracts_v2.closing_branch_id → lease_branches.id.
-- Fleet360 — 2026-06-29 (Layer 2.7 type-debt cleanup, follow-on)
--
-- Why this migration exists:
--   The Layer 2.6 V1→V2 cleanup accidentally dropped the @relation
--   directives on LeaseContract2.openingBranchId / closingBranchId
--   back to LeaseBranch. The columns themselves were untouched and
--   the data was preserved (rows in production point at valid
--   lease_branches.id values), so this is metadata-only at the SQL
--   level — a follow-up migration adds the FK constraint that the
--   schema now expects (per the Layer 2.7 prisma/schema.prisma edits
--   restoring those relations with named "OpeningBranch" /
--   "ClosingBranch" names to disambiguate the two FKs to the same
--   model).
--
--   Same pattern as 20260627000001_add_tenant_id_to_leasing_tables:
--     1) NOT VALID + VALIDATE CONSTRAINT — non-blocking add
--     2) ON DELETE RESTRICT — never cascade-delete lease data
--     3) No index — lease_branches is small and FK lookups are rare;
--        a bad value would surface as a constraint violation, not a
--        performance issue.
--
--   We use NOT VALID because the table may be large in production;
--   validating would take a long lock. The data was already checked
--   to be valid before the Layer 2.6 cleanup (the relations were
--   enforced at the Prisma layer before Layer 2.6 dropped them).
--
-- ============================================================

-- Pre-flight: refuse to run if any row references a missing branch.
-- Belt-and-braces: this should always be a no-op given the data history.
DO $$
DECLARE
  bad_opening_count BIGINT;
  bad_closing_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO bad_opening_count
    FROM lease_contracts_v2 c
    WHERE c.opening_branch_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM lease_branches b WHERE b.id = c.opening_branch_id);

  SELECT COUNT(*) INTO bad_closing_count
    FROM lease_contracts_v2 c
    WHERE c.closing_branch_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM lease_branches b WHERE b.id = c.closing_branch_id);

  IF bad_opening_count > 0 THEN
    RAISE EXCEPTION
      'add_lease_contract_branch_fk_constraints: % lease_contracts_v2 rows reference a missing opening_branch_id. Clean up first.', bad_opening_count;
  END IF;

  IF bad_closing_count > 0 THEN
    RAISE EXCEPTION
      'add_lease_contract_branch_fk_constraints: % lease_contracts_v2 rows reference a missing closing_branch_id. Clean up first.', bad_closing_count;
  END IF;
END $$;


-- opening_branch_id → lease_branches.id
ALTER TABLE "lease_contracts_v2"
  ADD CONSTRAINT "fk_lease_contracts_v2_opening_branch"
  FOREIGN KEY ("opening_branch_id") REFERENCES "lease_branches"("id") ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE "lease_contracts_v2"
  VALIDATE CONSTRAINT "fk_lease_contracts_v2_opening_branch";


-- closing_branch_id → lease_branches.id
ALTER TABLE "lease_contracts_v2"
  ADD CONSTRAINT "fk_lease_contracts_v2_closing_branch"
  FOREIGN KEY ("closing_branch_id") REFERENCES "lease_branches"("id") ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE "lease_contracts_v2"
  VALIDATE CONSTRAINT "fk_lease_contracts_v2_closing_branch";