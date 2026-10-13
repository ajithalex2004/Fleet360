-- Per-company user access (Admin > Users > Module Access) and the
-- Department master (Admin > Departments).
--
-- departments: each company's own list of departments, tenant-scoped with
-- the standard tenant_isolation policy. A user's department is now chosen
-- from it, per company.
--
-- user_tenants gains, per membership (user × company):
--   module_access  optional mask that narrows what the role grants in that
--                  company, e.g. {"logistics": ["view"], "finance": []}
--                  (src/lib/authz/access-mask.ts). NULL: the role applies
--                  as is. It is never copied from the old per-account
--                  "User".module_access, which nothing enforced: applying
--                  those values now could suddenly withhold access users
--                  have today.
--   department_id  the user's department in that company.
--
-- The free-text "User".department is carried over: each distinct value
-- becomes a department of every company the user belongs to, and the
-- membership points at it.
--
-- Safe to re-run.

SELECT set_config('app.tenant_id', '*', false);

CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_tenant_name_key ON departments (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_departments_tenant ON departments (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO fleet360_app;

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON departments;
CREATE POLICY tenant_isolation ON departments FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)));

ALTER TABLE user_tenants ADD COLUMN IF NOT EXISTS module_access JSONB;
ALTER TABLE user_tenants ADD COLUMN IF NOT EXISTS department_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_tenants_department_id_fkey') THEN
    ALTER TABLE user_tenants ADD CONSTRAINT user_tenants_department_id_fkey
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_user_tenants_department ON user_tenants (department_id);

-- Carry the free-text department over to each of the user's companies.
INSERT INTO departments (tenant_id, name)
SELECT DISTINCT ON (ut.tenant_id, lower(btrim(u.department))) ut.tenant_id, btrim(u.department)
  FROM user_tenants ut
  JOIN "User" u ON u.id = ut.user_id
 WHERE btrim(coalesce(u.department, '')) <> ''
ON CONFLICT (tenant_id, lower(name)) DO NOTHING;

UPDATE user_tenants ut
   SET department_id = d.id
  FROM "User" u, departments d
 WHERE u.id = ut.user_id
   AND d.tenant_id = ut.tenant_id
   AND lower(d.name) = lower(btrim(u.department))
   AND ut.department_id IS NULL;

SELECT set_config('app.tenant_id', '', false);
