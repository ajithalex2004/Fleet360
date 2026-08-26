-- Step 2: provision fleet360_app on the six application schemas.
--
-- fleet360_app is fully granted on `public` — 331 tables, 42 functions, and
-- default privileges for future tables — and has NOTHING on any other schema.
-- Not even USAGE, which makes any table grant there inert regardless.
--
--   finance     18 tables   including finance_payments and finance_invoices,
--                           which src/app/api/finance/payments/route.ts reads
--                           on every request
--   workforce    2 tables
--   ai / fleet / operations / spatial   1 each
--
-- Switching DATABASE_URL to fleet360_app before this lands would make every
-- query touching those schemas fail with 42501. That is not merely breakage —
-- it would wreck the activation pass, because a permission denial and an RLS
-- denial both present as "no rows or an error" and every finding would need
-- re-triage to tell which it was. The point of the pass is to isolate one
-- variable.
--
-- NEON_AUTH IS DELIBERATELY EXCLUDED. It holds 9 tables — user, session,
-- account, jwks, verification and so on — and is managed infrastructure, not
-- an application schema. The rule this migration follows is that fleet360_app
-- gets privileges only on schemas Fleet360 owns and intentionally accesses.
-- If something in the app turns out to need neon_auth, that should surface as
-- a visible 42501 and be argued for, not pre-granted in case.
--
-- ALTER DEFAULT PRIVILEGES applies to objects created BY THE ROLE THAT RUNS IT,
-- so running this as the wrong role would leave future objects ungranted while
-- appearing to succeed. Verified before writing: every schema and every table
-- in all seven schemas is owned by neondb_owner, which is also the role that
-- applies migrations here. The plain form is therefore correct and FOR ROLE is
-- not needed. The DO block below re-checks that at run time rather than
-- trusting the note.
--
-- public is included for SEQUENCES and FUNCTIONS only. It already has default
-- privileges for future TABLES granted to fleet360_app; it has none for the
-- other two object types, so a future migration adding a sequence or function
-- there would recreate exactly the gap this migration closes.
--
-- Idempotent. GRANT and ALTER DEFAULT PRIVILEGES are both safely repeatable.

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

  -- The correctness precondition for ALTER DEFAULT PRIVILEGES without FOR ROLE:
  -- the objects it is meant to cover must be created by the role running this.
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

    -- Without USAGE the table grants below grant nothing usable.
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', sch, app_role);

    -- Existing objects.
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', sch, app_role);
    EXECUTE format(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', sch, app_role);
    EXECUTE format(
      'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO %I', sch, app_role);

    -- Future objects, so the next migration does not reopen this.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', sch, app_role);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', sch, app_role);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO %I', sch, app_role);

    RAISE NOTICE 'provisioned % on schema %', app_role, sch;
  END LOOP;

  -- public already has the TABLES default; it is missing the other two.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', app_role);
  RAISE NOTICE 'added sequence and function defaults on public for %', app_role;

  -- Stated rather than done, so the exclusion is a decision on the record.
  RAISE NOTICE 'neon_auth deliberately NOT granted — managed infrastructure, not an application schema';
END $$;

-- Verify by asking Postgres what the role can actually do, rather than assuming
-- the GRANTs above had the intended effect.
DO $$
DECLARE
  app_role text := 'fleet360_app';
  sch      text;
  bad      text;
  n        int;
BEGIN
  FOREACH sch IN ARRAY ARRAY['finance', 'fleet', 'operations', 'spatial', 'workforce', 'ai'] LOOP
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

  -- neon_auth must remain untouched.
  IF has_schema_privilege(app_role, 'neon_auth', 'USAGE') THEN
    RAISE EXCEPTION 'verification failed: % has USAGE on neon_auth, which is meant to be excluded', app_role;
  END IF;

  -- All three default-privilege types must now exist for the role.
  FOREACH sch IN ARRAY ARRAY['r', 'S', 'f'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_default_acl d
       WHERE d.defaclobjtype = sch AND d.defaclacl::text LIKE '%' || app_role || '%'
    ) THEN
      RAISE EXCEPTION 'verification failed: no DEFAULT PRIVILEGES of type % for %', sch, app_role;
    END IF;
  END LOOP;
END $$;
