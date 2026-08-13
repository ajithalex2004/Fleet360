-- =====================================================================
-- Enforce the role-code rule at the database level
-- =====================================================================
--
-- The rule: role.code = 'SUPER_ADMIN' implies role.tenant_id IS NULL.
-- Always. No exceptions.
--
-- See:
--   - docs/TENANT_ISOLATION_STANDARD.md  (the "role-code rule" section)
--   - scripts/check-no-per-tenant-super-admin.mjs  (runtime check)
--
-- Why a CHECK constraint:
--   The runtime check covers the application path. The DB constraint
--   covers everything else — hand-edits, future code that bypasses the
--   check script, accidental bulk loads. The two together mean the
--   invariant is enforced at every layer that can write to the table.
--
-- Why this is essentially irreversible:
--   The constraint blocks a row from existing, so any future code that
--   wants a per-tenant SUPER_ADMIN would fail. To allow that (if ever
--   justified by the four-test framework in the doc), a one-page doc
--   and an explicit DROP CONSTRAINT migration would be required. That's
--   the right cost: if you ever need to violate this rule, you'll write
--   about it.
--
-- This migration:
--   1. Pre-checks for existing per-tenant SUPER_ADMIN roles and FAILS
--      loudly if any exist. Fix them with scripts/reassign-platform-admin.mjs
--      (or its pattern) before re-running.
--   2. Adds the CHECK constraint.

DO $$
DECLARE
  offender_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO offender_count
    FROM roles
   WHERE code = 'SUPER_ADMIN'
     AND tenant_id IS NOT NULL;

  IF offender_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add chk_super_admin_tenant: % per-tenant SUPER_ADMIN role(s) exist. '
      'Fix them first (see scripts/check-no-per-tenant-super-admin.mjs and '
      'scripts/reassign-platform-admin.mjs), then re-run this migration.',
      offender_count;
  END IF;
END
$$;

ALTER TABLE roles
  ADD CONSTRAINT chk_super_admin_tenant
  CHECK (code <> 'SUPER_ADMIN' OR tenant_id IS NULL);
