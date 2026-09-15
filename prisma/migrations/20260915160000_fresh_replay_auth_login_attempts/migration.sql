-- Closes the "auth_login_attempts" row from issue #77's audit.
--
-- 20260910000003_login_attempts_platform_only is already applied on every
-- real environment and is left untouched, same approach as every
-- migration in this series. Same untracked-legacy-table pattern as
-- trip_schedules/route_passengers — the table has no tracked CREATE TABLE
-- anywhere and no Prisma model; per that migration's own comment, nothing
-- in this repository writes to it ("an external auth service, the Go
-- backend, or an earlier version" does). Its migration only rebuilds an
-- existing policy and enables RLS, assuming the table is already there —
-- on a fresh replay it isn't, so both fail.
--
-- Recreated here with the exact live DDL (pg_dump'd from production),
-- including the already-correct ASYMMETRIC policy that migration
-- deliberately designed: USING excludes tenant_id IS NULL (unattributable
-- failed-login rows are platform-admin-only for reads — a real, if
-- disabled, cross-tenant enumeration surface otherwise), WITH CHECK
-- includes it (so an unattributable attempt can still be recorded from a
-- non-platform context — closing the read leak must not also break
-- security telemetry writes). Reproduced verbatim, not re-derived.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260910000003_login_attempts_platform_only

CREATE TABLE IF NOT EXISTS public.auth_login_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    email text NOT NULL,
    tenant_id text,
    user_id text,
    success boolean DEFAULT false NOT NULL,
    failure_reason text,
    ip_address text,
    user_agent text,
    locked_until timestamp with time zone,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_email_time ON public.auth_login_attempts USING btree (email, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_tenant_id ON public.auth_login_attempts USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_tenant_time ON public.auth_login_attempts USING btree (tenant_id, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_login_attempts TO fleet360_app;

ALTER TABLE public.auth_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_login_attempts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.auth_login_attempts;
CREATE POLICY tenant_isolation ON public.auth_login_attempts
  USING (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    tenant_id IS NULL
    OR current_setting('app.tenant_id', true) = '*'
    OR tenant_id = current_setting('app.tenant_id', true)
  );
