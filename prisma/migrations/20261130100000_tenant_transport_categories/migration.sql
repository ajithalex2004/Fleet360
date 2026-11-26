-- Customer Portal 3b: the Transport categories a tenant offers, and its
-- changes to each category's request form.
--
--  tenant_transport_categories   one row per tenant and category it has set up.
--    enabled            offered to customers (onboarding can only pick enabled ones)
--    approval_required  requests need approval before dispatch (used from 3c)
--    field_overrides    { fieldKey: { hidden?: bool, required?: bool } } applied
--                       to the default form in src/lib/transport-catalog
--
-- No row = not offered. Backfill: every category a tenant has already given
-- to a customer (customer_portal_access.categories) is enabled. Additive only.

CREATE TABLE IF NOT EXISTS tenant_transport_categories (
  tenant_id          TEXT         NOT NULL,
  category           TEXT         NOT NULL CHECK (category IN ('RAC', 'LEASING', 'LIMOUSINE', 'STAFF_TRANSPORT',
                                                               'EXECUTIVE', 'LOGISTICS', 'SCHOOL_BUS', 'RECOVERY')),
  enabled            BOOLEAN      NOT NULL DEFAULT TRUE,
  approval_required  BOOLEAN      NOT NULL DEFAULT FALSE,
  field_overrides    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_by         TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, category)
);

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.tenant_transport_categories';
  EXECUTE 'CREATE POLICY tenant_isolation ON public.tenant_transport_categories FOR ALL
     USING ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))
     WITH CHECK ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))';
  EXECUTE 'ALTER TABLE public.tenant_transport_categories ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.tenant_transport_categories FORCE ROW LEVEL SECURITY';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_transport_categories TO fleet360_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_transport_categories TO fleet360_api_role';
  END IF;
END $$;

INSERT INTO tenant_transport_categories (tenant_id, category, enabled, updated_by)
SELECT DISTINCT a.tenant_id, c.category, TRUE, 'migration:customer-categories'
  FROM customer_portal_access a
 CROSS JOIN LATERAL unnest(a.categories) AS c(category)
 WHERE a.portal = 'TRANSPORT'
ON CONFLICT (tenant_id, category) DO NOTHING;
