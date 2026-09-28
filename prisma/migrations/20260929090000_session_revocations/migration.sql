-- Session revocation: "sessions issued before this moment are no longer
-- valid", for a user, a tenant, or a user in one tenant.
--
-- Written by src/lib/auth/session-revocation.ts when a role or membership
-- changes, a user or tenant is deactivated, a password is reset, or a user
-- signs out everywhere; also mirrored to Redis for the edge middleware.
-- Read by the Next.js middleware (via the Redis mirror) and by the Go
-- backend's auth middleware (this table), each re-checking at most every
-- 60 seconds, so revocation takes effect within about a minute.
--
-- One row per scope (user_id, tenant_id), either of which may be NULL:
--   (user, NULL)    every session of the user, in every tenant
--   (NULL, tenant)  every session in the tenant
--   (user, tenant)  the user's sessions in that tenant
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS session_revocations (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT,
  tenant_id    TEXT,
  not_before   TIMESTAMPTZ(6) NOT NULL,
  reason       TEXT NOT NULL,
  revoked_by   TEXT,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT session_revocations_scope CHECK (user_id IS NOT NULL OR tenant_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_revocations_scope
  ON session_revocations (COALESCE(user_id, ''), COALESCE(tenant_id, ''));

DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.session_revocations TO fleet360_app;
  END IF;

  FOR pol IN SELECT policyname FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'session_revocations' LOOP
    EXECUTE format('DROP POLICY %I ON public.session_revocations', pol.policyname);
  END LOOP;
  ALTER TABLE public.session_revocations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.session_revocations FORCE ROW LEVEL SECURITY;
  -- Platform context sees and writes everything. A tenant context reads its
  -- own tenant's rows and user-wide rows (tenant_id NULL: user id and a
  -- timestamp only), which is what a per-request revocation check needs.
  CREATE POLICY session_revocations_access ON public.session_revocations FOR ALL
    USING (current_setting('app.tenant_id', true) = '*'
           OR tenant_id IS NULL
           OR tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (current_setting('app.tenant_id', true) = '*');
END $$;
