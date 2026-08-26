-- roles: keep the NULL-tenant escape, fix the one row that breaks the model.
--
-- Unlike the 46 tables in 20260910000000 and 20260910000001, `tenant_id IS NULL`
-- here is not legacy debt — it IS the platform-role model, and the application
-- depends on it. src/app/api/admin/session/route.ts grants platform-wide
-- permissions on exactly this condition:
--
--     if (userTenant.role.code === 'SUPER_ADMIN' && userTenant.role.tenantId === null) {
--       permStrings.push('*:*:*');
--     }
--
-- Removing the escape would break super-admin. The escape stays.
--
-- What does need fixing is the single row that violates the invariant the model
-- rests on:
--
--     tenant_id IS NULL  <=>  is_system = true
--
-- Current data:
--
--     tenant_id IS NULL = false, is_system = false   126 rows   tenant roles
--     tenant_id IS NULL = true,  is_system = true     10 rows   platform templates
--     tenant_id IS NULL = true,  is_system = false     1 row    FLEET_MANAGER
--
-- FLEET_MANAGER is a platform template whose is_system flag is wrong, not a
-- tenant role that lost its tenant. The evidence:
--
--   * It carries 20 role_permissions and 0 assigned users — the same shape as
--     the other templates (LEASING_MANAGER 41, TENANT_ADMIN 89, RAC_MANAGER 12,
--     TRANSPORT_MANAGER 12, VIEWER 14), none of which have users either.
--   * The NULL-tenant set is one manager/operator pair per module — LEASING,
--     RAC, TRANSPORT, FINANCE. FLEET_MANAGER is the fleet module's entry. A
--     tenant-specific role would not sit in that set, and would have a tenant.
--   * All 126 genuine tenant roles have both a tenant_id and is_system = false.
--
-- So the fix is the flag, not the tenant.
--
-- The CHECK is added now rather than "eventually" for the same reason every
-- other constraint in this series went in early: there is exactly one violation
-- and it is being fixed in the statement above, so the invariant is satisfiable
-- right now. Later it would need a survey first.
--
-- is_system is nullable, and a CHECK passes on NULL, so a role created without
-- the flag is not blocked by this. That is deliberate — this constraint exists
-- to stop the two states CONTRADICTING each other, not to mandate the flag.
--
-- Idempotent.

-- 1. The one anomalous row.
UPDATE public.roles
   SET is_system = true
 WHERE code = 'FLEET_MANAGER'
   AND tenant_id IS NULL
   AND is_system IS DISTINCT FROM true;

-- 2. Enforce the invariant from here on.
DO $$
DECLARE
  violations int;
BEGIN
  SELECT count(*) INTO violations
    FROM public.roles
   WHERE is_system IS NOT NULL AND (tenant_id IS NULL) <> is_system;

  IF violations > 0 THEN
    RAISE EXCEPTION
      'cannot add chk_roles_system_template: % row(s) still violate (tenant_id IS NULL) = is_system', violations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'roles' AND c.conname = 'chk_roles_system_template'
  ) THEN
    ALTER TABLE public.roles
      ADD CONSTRAINT chk_roles_system_template
      CHECK (is_system IS NULL OR (tenant_id IS NULL) = is_system);
    RAISE NOTICE 'chk_roles_system_template added';
  ELSE
    RAISE NOTICE 'chk_roles_system_template already present';
  END IF;
END $$;
