-- Tenant-configurable departments for the service-ticket forwarding workflow.
--
-- Until now departments were a hardcoded list of six (TICKET_DEPARTMENTS in
-- src/types/service-tickets.ts). Rows here let a tenant rename or hide those
-- six (same key) and add its own, e.g. Facilities hard / soft services.
-- Tenants with no rows keep the six built-ins (resolved in
-- src/lib/service-tickets/departments.ts), so this is additive.

CREATE TABLE IF NOT EXISTS service_departments (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT         NOT NULL,
  key          TEXT         NOT NULL,
  label        TEXT         NOT NULL,
  short_label  TEXT         NOT NULL,
  description  TEXT         NOT NULL DEFAULT '',
  tone         TEXT         NOT NULL DEFAULT 'slate',
  sort_order   INTEGER      NOT NULL DEFAULT 100,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS idx_service_departments_tenant ON service_departments (tenant_id);

-- Tenant isolation, same policy shape as service_tickets.
DROP POLICY IF EXISTS tenant_isolation ON public.service_departments;
CREATE POLICY tenant_isolation ON public.service_departments FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)));
ALTER TABLE public.service_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_departments FORCE ROW LEVEL SECURITY;

-- Runtime role grants (same pattern as 20261117051500).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_departments TO fleet360_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_departments TO fleet360_api_role;
  END IF;
END $$;
