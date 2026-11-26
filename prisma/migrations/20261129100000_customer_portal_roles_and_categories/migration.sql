-- Customer Portal 3a: one account per person, a role per portal, and the
-- Transport categories each customer may use.
--
--  customer_portal_user_roles   the portals an account may use and its role in
--                               each (FSM / TRANSPORT x ADMIN / REQUESTER /
--                               VIEWER). Replaces the single role column on
--                               customer_portal_users, which is kept but no
--                               longer read.
--  customer_portal_access       + categories: the Transport categories enabled
--                               for the customer (RAC, LEASING, LIMOUSINE,
--                               STAFF_TRANSPORT, EXECUTIVE, LOGISTICS,
--                               SCHOOL_BUS, RECOVERY). The Shipper portal is
--                               the LOGISTICS category.
--
-- Backfill:
--   FSM_ADMIN / FSM_REQUESTER / FSM_VIEWER  -> FSM role
--   SHIPPER_ADMIN                           -> TRANSPORT ADMIN
--   any other role (Shipper users)          -> TRANSPORT REQUESTER
--   customers with Shipper users            -> TRANSPORT access with LOGISTICS
-- Additive only.

CREATE TABLE IF NOT EXISTS customer_portal_user_roles (
  tenant_id          TEXT         NOT NULL,
  portal_user_id     UUID         NOT NULL,
  portal             TEXT         NOT NULL CHECK (portal IN ('FSM', 'TRANSPORT')),
  role               TEXT         NOT NULL CHECK (role IN ('ADMIN', 'REQUESTER', 'VIEWER')),
  granted_by_user_id TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portal_user_id, portal)
);
CREATE INDEX IF NOT EXISTS idx_customer_portal_user_roles_tenant
  ON customer_portal_user_roles (tenant_id, portal);

ALTER TABLE customer_portal_access ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_portal_access_categories_check') THEN
    ALTER TABLE customer_portal_access ADD CONSTRAINT customer_portal_access_categories_check
      CHECK (categories <@ ARRAY['RAC', 'LEASING', 'LIMOUSINE', 'STAFF_TRANSPORT', 'EXECUTIVE',
                                 'LOGISTICS', 'SCHOOL_BUS', 'RECOVERY']::TEXT[]);
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.customer_portal_user_roles';
  EXECUTE 'CREATE POLICY tenant_isolation ON public.customer_portal_user_roles FOR ALL
     USING ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))
     WITH CHECK ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))';
  EXECUTE 'ALTER TABLE public.customer_portal_user_roles ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.customer_portal_user_roles FORCE ROW LEVEL SECURITY';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_portal_user_roles TO fleet360_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_portal_user_roles TO fleet360_api_role';
  END IF;
END $$;

-- ── Backfill ────────────────────────────────────────────────────────────────

INSERT INTO customer_portal_user_roles (tenant_id, portal_user_id, portal, role)
SELECT u.tenant_id, u.id, 'FSM', substring(u.role FROM 5)
  FROM customer_portal_users u
 WHERE u.deleted_at IS NULL AND u.role IN ('FSM_ADMIN', 'FSM_REQUESTER', 'FSM_VIEWER')
ON CONFLICT (portal_user_id, portal) DO NOTHING;

INSERT INTO customer_portal_user_roles (tenant_id, portal_user_id, portal, role)
SELECT u.tenant_id, u.id, 'TRANSPORT', CASE WHEN u.role = 'SHIPPER_ADMIN' THEN 'ADMIN' ELSE 'REQUESTER' END
  FROM customer_portal_users u
 WHERE u.deleted_at IS NULL AND left(u.role, 4) <> 'FSM_'
ON CONFLICT (portal_user_id, portal) DO NOTHING;

INSERT INTO customer_portal_access (tenant_id, customer_id, portal, enabled_by, categories)
SELECT DISTINCT u.tenant_id, u.customer_id, 'TRANSPORT', 'migration:shipper-portal', ARRAY['LOGISTICS']::TEXT[]
  FROM customer_portal_users u
  JOIN customer_portal_user_roles r ON r.portal_user_id = u.id AND r.portal = 'TRANSPORT'
 WHERE u.deleted_at IS NULL
ON CONFLICT (tenant_id, customer_id, portal) DO UPDATE
   SET categories = CASE WHEN 'LOGISTICS' = ANY (customer_portal_access.categories)
                         THEN customer_portal_access.categories
                         ELSE customer_portal_access.categories || ARRAY['LOGISTICS']::TEXT[] END;
