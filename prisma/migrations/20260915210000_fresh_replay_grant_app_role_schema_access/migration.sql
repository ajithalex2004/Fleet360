-- Closes the "20260910000010" row from issue #77's audit.
--
-- 20260910000010_grant_app_role_schema_access is already applied on every
-- real environment and is left untouched, same approach as every migration
-- in this series. Its provisioning block already guards every schema it
-- touches against not existing yet (`IF NOT EXISTS (... pg_namespace ...)
-- THEN ... CONTINUE`) — that part is not the bug, and genuinely does not
-- need fixing.
--
-- The bug is in the migration's own closing verification, which calls
-- has_schema_privilege(role, schema_name, 'USAGE') for each of the six
-- target schemas with no equivalent existence guard. Unlike a plain
-- privilege check, has_schema_privilege() raises "schema % does not exist"
-- — it does not return false — when the schema name it's given genuinely
-- doesn't exist. On live all six already existed (via the untracked legacy
-- path, same as everywhere else in this series) so this was never
-- observable. On a fresh replay, fleet/operations/spatial/workforce don't
-- exist yet at this point (only finance/ai do — fleet and operations are
-- created later still, by 20260914010000_close_untracked_domain_schema_gap
-- and this series' own fix for 20260910000008) — the verification loop
-- reaches 'fleet' and raises before it gets anywhere near evaluating grants
-- for the schemas that do exist.
--
-- A second, narrower version of the identical bug: the neon_auth check
-- immediately below the loop has the same has_schema_privilege() call with
-- no guard either. On a real Neon-hosted database neon_auth is
-- platform-provisioned and always present, so this was never a problem on
-- live or on any Neon-hosted fresh database. It only surfaces when testing
-- this replay chain against a plain (non-Neon) Postgres instance, which has
-- no such schema — guarded here too, for the same reason and at the same
-- cost, since the whole point of a defensive guard is not needing to know
-- in advance which environment will lack the thing it checks for.
--
-- Fix: re-run both DO blocks verbatim, with an existence guard added to the
-- verification block's loop and its neon_auth check — the provisioning
-- logic itself is untouched. Safe no-op on every real environment, where
-- every schema this checks already exists.
--
-- A fresh database still needs one manual step before this migration's
-- effects apply:
--   npx prisma migrate resolve --applied 20260910000010_grant_app_role_schema_access

DO $$
DECLARE
  sch       text;
  wrong     text;
  app_role  text := 'fleet360_app';
  schemas   text[] := ARRAY['finance', 'fleet', 'operations', 'spatial', 'workforce', 'ai'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'role % does not exist', app_role;
  END IF;

  SELECT string_agg(DISTINCT n.nspname || ' (owner ' || pg_get_userbyid(c.relowner) || ')', ', ')
    INTO wrong
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY(schemas || ARRAY['public'])
     AND c.relkind IN ('r', 'S')
     AND pg_get_userbyid(c.relowner) <> current_user;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION
      'objects in % are not owned by % — ALTER DEFAULT PRIVILEGES here would not cover them; use FOR ROLE', wrong, current_user;
  END IF;

  FOREACH sch IN ARRAY schemas LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = sch) THEN
      RAISE NOTICE 'SKIP schema % — does not exist', sch;
      CONTINUE;
    END IF;

    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', sch, app_role);

    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', sch, app_role);
    EXECUTE format(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', sch, app_role);
    EXECUTE format(
      'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO %I', sch, app_role);

    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', sch, app_role);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', sch, app_role);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO %I', sch, app_role);

    RAISE NOTICE 'provisioned % on schema %', app_role, sch;
  END LOOP;

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', app_role);
  RAISE NOTICE 'added sequence and function defaults on public for %', app_role;

  RAISE NOTICE 'neon_auth deliberately NOT granted — managed infrastructure, not an application schema';
END $$;

-- Verify, same as the original, with existence guards added for both the
-- per-schema loop and the neon_auth check — see comment above.
DO $$
DECLARE
  app_role text := 'fleet360_app';
  sch      text;
  bad      text;
  n        int;
BEGIN
  FOREACH sch IN ARRAY ARRAY['finance', 'fleet', 'operations', 'spatial', 'workforce', 'ai'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = sch) THEN
      RAISE NOTICE 'SKIP verification for schema % — does not exist yet', sch;
      CONTINUE;
    END IF;

    IF NOT has_schema_privilege(app_role, sch, 'USAGE') THEN
      RAISE EXCEPTION 'verification failed: % lacks USAGE on schema %', app_role, sch;
    END IF;

    SELECT count(*), string_agg(c.relname, ', ') INTO n, bad
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = sch AND c.relkind = 'r'
       AND NOT (has_table_privilege(app_role, c.oid, 'SELECT')
            AND has_table_privilege(app_role, c.oid, 'INSERT')
            AND has_table_privilege(app_role, c.oid, 'UPDATE')
            AND has_table_privilege(app_role, c.oid, 'DELETE'));
    IF n > 0 THEN
      RAISE EXCEPTION 'verification failed: % lacks full DML on %.%', app_role, sch, bad;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'neon_auth') THEN
    IF has_schema_privilege(app_role, 'neon_auth', 'USAGE') THEN
      RAISE EXCEPTION 'verification failed: % has USAGE on neon_auth, which is meant to be excluded', app_role;
    END IF;
  ELSE
    RAISE NOTICE 'SKIP neon_auth exclusion check — schema does not exist in this environment';
  END IF;

  FOREACH sch IN ARRAY ARRAY['r', 'S', 'f'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_default_acl d
       WHERE d.defaclobjtype = sch AND d.defaclacl::text LIKE '%' || app_role || '%'
    ) THEN
      RAISE EXCEPTION 'verification failed: no DEFAULT PRIVILEGES of type % for %', sch, app_role;
    END IF;
  END LOOP;
END $$;
