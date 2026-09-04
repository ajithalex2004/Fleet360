-- Move runtime DDL out of src/app/api/school-bus/capacity-check/route.ts
-- and src/lib/school-bus-notify.ts.
--
-- school_bus_routes is ALSO created/altered at runtime by the separate
-- (out-of-scope, deferred) src/lib/dispatch/schema.ts, which additively
-- ALTERs in is_active and reassignment_history alongside several columns
-- already present here. That file is untouched — its ADD COLUMN IF NOT
-- EXISTS statements keep running harmlessly at request time regardless
-- of whether this table was created by this migration or by that file
-- running first on a given database.
--
-- school_bus_guardian_notifications is migrated as DDL-only: it's written
-- from notifyGuardians() via the bare `prisma` client, not inside a
-- withTenantRls-scoped transaction, and adding tenant_id/RLS here would
-- need threading a tenantId parameter through that call chain (and its
-- callers) — a real behavioural change, not just a DDL relocation. Left
-- for a follow-up.

CREATE TABLE IF NOT EXISTS school_bus_routes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT        NOT NULL DEFAULT 'default',
  route_name          TEXT        NOT NULL,
  route_code          TEXT,
  direction           TEXT        NOT NULL DEFAULT 'PICKUP',
  session             TEXT        NOT NULL DEFAULT 'MORNING',
  route_type          TEXT        NOT NULL DEFAULT 'STUDENT',
  departure_time      TIME        NOT NULL,
  arrival_time        TIME,
  assigned_vehicle_id TEXT,
  assigned_driver_id  TEXT,
  assigned_attendant_id TEXT,
  seat_capacity       INT         NOT NULL DEFAULT 40,
  student_count       INT         NOT NULL DEFAULT 0,
  waypoints           JSONB       NOT NULL DEFAULT '[]',
  stop_sequence       JSONB       NOT NULL DEFAULT '[]',
  status              TEXT        NOT NULL DEFAULT 'ACTIVE',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_bus_guardian_notifications (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         UUID         NOT NULL,
  kind               TEXT         NOT NULL,
  subject            TEXT,
  body               TEXT,
  reached_guardian1  BOOLEAN      NOT NULL DEFAULT FALSE,
  reached_guardian2  BOOLEAN      NOT NULL DEFAULT FALSE,
  attempts_json      JSONB,
  sent_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_bus_guardian_notif_student
  ON school_bus_guardian_notifications (student_id, sent_at DESC);

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'school_bus_routes']
  ];
  i int;
  sch text;
  tbl text;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    sch := targets[i][1];
    tbl := targets[i][2];

    IF to_regclass(quote_ident(sch) || '.' || quote_ident(tbl)) IS NULL THEN
      RAISE NOTICE 'SKIP %.% — does not exist', sch, tbl;
      CONTINUE;
    END IF;

    SELECT data_type, is_nullable INTO coltype, nullable
      FROM information_schema.columns
     WHERE table_schema = sch AND table_name = tbl AND column_name = 'tenant_id';

    IF coltype IS NULL THEN
      RAISE NOTICE 'SKIP %.% — no tenant_id column', sch, tbl;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I WHERE tenant_id IS NULL', sch, tbl) INTO nulls;

    IF nullable = 'YES' AND nulls = 0 THEN
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN tenant_id SET NOT NULL', sch, tbl);
    ELSIF nulls > 0 THEN
      RAISE NOTICE '%.% has % NULL-tenant row(s) — column left nullable, rows become platform-only', sch, tbl, nulls;
    END IF;

    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', sch, tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I FOR ALL USING (%s) WITH CHECK (%s)',
      sch, tbl, expr, expr);

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', sch, tbl);

    done := done + 1;
    RAISE NOTICE 'RLS enabled on %.% (tenant_id %, % rows had NULL)', sch, tbl, coltype, nulls;
  END LOOP;

  RAISE NOTICE 'enabled RLS on % of % tables', done, array_length(targets, 1);
END $$;
