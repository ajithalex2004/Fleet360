-- auth_login_attempts: unattributable security events become platform-only.
--
-- 237 rows, 124 with no tenant. The current policy carries the generic escape
-- in BOTH USING and WITH CHECK:
--
--     tenant_id IS NULL OR current_setting('app.tenant_id') = '*'
--                       OR tenant_id = current_setting('app.tenant_id')
--
-- so every tenant can read all 124 — 12 distinct email addresses, plus
-- ip_address, user_agent, failure_reason and locked_until. None of those
-- attempts succeeded, so no session data is exposed, but it is a clean
-- cross-tenant enumeration surface: which addresses were tried, from where, and
-- which are locked out.
--
-- NULL is the right representation here and a sentinel tenant is not — a failed
-- login for an unrecognised address genuinely has no owner, and inventing one
-- would create fake ownership that later security tooling would have to
-- un-learn. What is wrong is the VISIBILITY of those rows, not their tenancy.
--
-- The intended model:
--
--     attributable attempt      tenant_id = the user's tenant
--                               -> visible to that tenant
--     unattributable attempt    tenant_id = NULL
--                               -> visible to platform/security context only
--
-- This is achieved by an ASYMMETRY between the two halves of the policy, which
-- is the whole point of the change:
--
--     USING       drops the IS NULL branch. A NULL-tenant row now matches only
--                 through current_setting('app.tenant_id') = '*', i.e. only
--                 inside withPlatformAdmin. Ordinary tenant sessions cannot see
--                 it at all.
--     WITH CHECK  keeps the IS NULL branch, so an unattributable attempt can
--                 still be RECORDED from a non-platform context. Without this
--                 the write would be rejected and failed logins for unknown
--                 addresses would stop being logged — trading an information
--                 leak for a security-telemetry gap.
--
-- The column stays nullable. That is required by the model, not an oversight,
-- and it is why this table was held back from 20260910000000.
--
-- NO BACKFILL IS PERFORMED, and this is a correction to the plan rather than an
-- omission. Six of the 124 NULL rows carry a user_id and were expected to be
-- attributable from it. They are not: all six resolve to users with ZERO rows
-- in user_tenants, so there is no tenant to assign. Writing one would be
-- guessing, which is the thing this whole exercise exists to stop. They remain
-- NULL and are now platform-only, which is the correct outcome for a failed
-- login by a user with no tenant membership.
--
-- THE WRITE PATH IS NOT FIXED HERE BECAUSE IT IS NOT IN THIS REPOSITORY. A
-- repo-wide search for auth_login_attempts / authLoginAttempt / LoginAttempt
-- matches only migrations and audit scripts. There is no Prisma model for the
-- table and no code that inserts into it. Whatever produced these 237 rows —
-- an external auth service, the Go backend, or an earlier version — lives
-- elsewhere, and "make attributable attempts carry a tenant" has to be applied
-- there. The policy change below is safe regardless: it tightens reads and
-- leaves writes working exactly as they do today.
--
-- Idempotent.

DO $$
DECLARE
  using_expr text := '(current_setting(''app.tenant_id'', true) = ''*'')'
                  || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
  check_expr text := '(tenant_id IS NULL)'
                  || ' OR (current_setting(''app.tenant_id'', true) = ''*'')'
                  || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
  pn text;
BEGIN
  FOR pn IN
    SELECT pol.polname
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'auth_login_attempts'
       AND pol.polcmd = '*' AND pol.polpermissive
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.auth_login_attempts', pn);
    EXECUTE format(
      'CREATE POLICY %I ON public.auth_login_attempts FOR ALL USING (%s) WITH CHECK (%s)',
      pn, using_expr, check_expr);
    RAISE NOTICE 'rebuilt policy % — NULL-tenant rows are now platform-only for reads', pn;
  END LOOP;

  ALTER TABLE public.auth_login_attempts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.auth_login_attempts FORCE ROW LEVEL SECURITY;
END $$;

-- Verify the asymmetry actually landed: reads must NOT admit NULL tenants,
-- writes must.
DO $$
DECLARE
  bad_using int;
  ok_check  int;
BEGIN
  SELECT count(*) INTO bad_using
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'auth_login_attempts'
     AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%tenant_id IS NULL%';

  SELECT count(*) INTO ok_check
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'auth_login_attempts'
     AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%tenant_id IS NULL%';

  IF bad_using > 0 THEN
    RAISE EXCEPTION 'verification failed: USING still admits NULL-tenant rows to ordinary tenants';
  END IF;
  IF ok_check = 0 THEN
    RAISE EXCEPTION 'verification failed: WITH CHECK no longer permits NULL-tenant writes — unattributable attempts would stop being logged';
  END IF;
END $$;
