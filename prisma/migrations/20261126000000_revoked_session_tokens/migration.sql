-- Durable per-session / per-token revocation store (Track C).
--
-- Persists single-device logouts and explicit token invalidations durably in
-- PostgreSQL so that:
--   1. Single-device logout revokes BOTH the Next.js xl-session cookie AND the
--      paired Go backend HS256 Bearer JWT (linked via shared `sid` / `jti`)
--      immediately across all replicas.
--   2. Revocations survive Upstash Redis outages, restarts, or key evictions.
--   3. Expired rows are bounded and pruned via idx_revoked_session_tokens_expires_at.
--
-- Key formats in `token_key`:
--   - `sid:<uuid>`   paired Next.js + Go session identifier (preferred)
--   - `tok:<sha256>` SHA-256 hex fingerprint of raw token (legacy / standalone fallback)
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.revoked_session_tokens (
  token_key       TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  expires_at      TIMESTAMPTZ(6) NOT NULL,
  revoked_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  reason          TEXT NOT NULL,
  redis_synced_at TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS idx_revoked_session_tokens_tenant_id
  ON public.revoked_session_tokens (tenant_id);

CREATE INDEX IF NOT EXISTS idx_revoked_session_tokens_expires_at
  ON public.revoked_session_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_revoked_session_tokens_user_tenant
  ON public.revoked_session_tokens (user_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_revoked_session_tokens_unsynced
  ON public.revoked_session_tokens (revoked_at)
  WHERE redis_synced_at IS NULL;

DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.revoked_session_tokens TO fleet360_app;
  END IF;

  FOR pol IN SELECT policyname FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'revoked_session_tokens' LOOP
    EXECUTE format('DROP POLICY %I ON public.revoked_session_tokens', pol.policyname);
  END LOOP;

  ALTER TABLE public.revoked_session_tokens ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.revoked_session_tokens FORCE ROW LEVEL SECURITY;

  -- Canonical tenant-scoped permissive policies across all 4 commands (tenant_id NOT NULL,
  -- zero NULL-escape, satisfies scripts/check-rls-effective.mjs as SCOPED with no allowlist).
  CREATE POLICY revoked_session_tokens_select ON public.revoked_session_tokens
    FOR SELECT
    USING (
      (current_setting('app.tenant_id', true) = '*')
      OR (tenant_id = current_setting('app.tenant_id', true))
    );

  CREATE POLICY revoked_session_tokens_insert ON public.revoked_session_tokens
    FOR INSERT
    WITH CHECK (
      (current_setting('app.tenant_id', true) = '*')
      OR (tenant_id = current_setting('app.tenant_id', true))
    );

  CREATE POLICY revoked_session_tokens_update ON public.revoked_session_tokens
    FOR UPDATE
    USING (
      (current_setting('app.tenant_id', true) = '*')
      OR (tenant_id = current_setting('app.tenant_id', true))
    )
    WITH CHECK (
      (current_setting('app.tenant_id', true) = '*')
      OR (tenant_id = current_setting('app.tenant_id', true))
    );

  CREATE POLICY revoked_session_tokens_delete ON public.revoked_session_tokens
    FOR DELETE
    USING (
      (current_setting('app.tenant_id', true) = '*')
      OR (tenant_id = current_setting('app.tenant_id', true))
    );

  -- Restrictive write guards: only platform context ('*') may INSERT, UPDATE, or DELETE.
  -- Tenant-scoped queries (e.g. Go auth middleware, Node.js durable checks) can ONLY SELECT
  -- their own tenant's revocation rows and can never read/forge/delete another tenant's rows.
  CREATE POLICY revoked_session_tokens_platform_insert ON public.revoked_session_tokens
    AS RESTRICTIVE FOR INSERT
    WITH CHECK (current_setting('app.tenant_id', true) = '*');

  CREATE POLICY revoked_session_tokens_platform_update ON public.revoked_session_tokens
    AS RESTRICTIVE FOR UPDATE
    USING (current_setting('app.tenant_id', true) = '*')
    WITH CHECK (current_setting('app.tenant_id', true) = '*');

  CREATE POLICY revoked_session_tokens_platform_delete ON public.revoked_session_tokens
    AS RESTRICTIVE FOR DELETE
    USING (current_setting('app.tenant_id', true) = '*');
END $$;
