-- Customer Portal (Phase 2): customer users, invitations and portal access.
--
--  customer_portal_users        people at a customer company who sign in to the
--                               portal (separate identity from staff users).
--  customer_portal_invitations  single-use invite tokens (only the SHA-256 hash
--                               is stored) used to set a password.
--  customer_portal_access       which portals a customer is given at onboarding
--                               (FSM, TRANSPORT).
--
-- Additive only. Same tenant-isolation policy and grants as the other
-- tenant tables (see 20261126100000_fsm_service_request_foundations).

CREATE TABLE IF NOT EXISTS customer_portal_users (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          TEXT         NOT NULL,
  customer_id        TEXT         NOT NULL,
  email              TEXT         NOT NULL,
  full_name          TEXT,
  mobile             TEXT,
  role               TEXT         NOT NULL DEFAULT 'REQUESTER'
                       CHECK (role IN ('ADMIN', 'REQUESTER', 'VIEWER')),
  password_hash      TEXT,
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  session_version    INTEGER      NOT NULL DEFAULT 1,
  last_login_at      TIMESTAMPTZ,
  invited_by_user_id TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_portal_users_tenant_email
  ON customer_portal_users (tenant_id, lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_portal_users_customer
  ON customer_portal_users (tenant_id, customer_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_portal_invitations (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          TEXT         NOT NULL,
  portal_user_id     UUID         NOT NULL,
  token_hash         TEXT         NOT NULL UNIQUE,
  expires_at         TIMESTAMPTZ  NOT NULL,
  accepted_at        TIMESTAMPTZ,
  invited_by_user_id TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_portal_invitations_user
  ON customer_portal_invitations (tenant_id, portal_user_id);

CREATE TABLE IF NOT EXISTS customer_portal_access (
  tenant_id    TEXT         NOT NULL,
  customer_id  TEXT         NOT NULL,
  portal       TEXT         NOT NULL CHECK (portal IN ('FSM', 'TRANSPORT')),
  enabled_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  enabled_by   TEXT,
  PRIMARY KEY (tenant_id, customer_id, portal)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_portal_users', 'customer_portal_invitations', 'customer_portal_access'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL
         USING ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))
         WITH CHECK ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_api_role', t);
    END IF;
  END LOOP;
END $$;
