-- New User form (Admin > Users > New User, Tenant > Users, Tenant >
-- Invitations): an invitation now carries everything the admin chose, and
-- accepting it applies it to the new membership:
--
--   first_name, last_name, mobile_number, position   the invitee's profile
--                                                     (pre-filled on the
--                                                     accept page)
--   department_id   the department in this company (departments)
--   module_access   module access narrowing the role in this company
--                   (user_tenants.module_access, src/lib/authz/access-mask.ts)
--
-- Safe to re-run.

ALTER TABLE tenant_invitations ADD COLUMN IF NOT EXISTS first_name    TEXT;
ALTER TABLE tenant_invitations ADD COLUMN IF NOT EXISTS last_name     TEXT;
ALTER TABLE tenant_invitations ADD COLUMN IF NOT EXISTS mobile_number TEXT;
ALTER TABLE tenant_invitations ADD COLUMN IF NOT EXISTS position      TEXT;
ALTER TABLE tenant_invitations ADD COLUMN IF NOT EXISTS department_id UUID;
ALTER TABLE tenant_invitations ADD COLUMN IF NOT EXISTS module_access JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_invitations_department_id_fkey') THEN
    ALTER TABLE tenant_invitations ADD CONSTRAINT tenant_invitations_department_id_fkey
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;
