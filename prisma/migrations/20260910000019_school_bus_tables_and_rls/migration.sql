-- Move runtime DDL out of the 9 school-bus route files into a real
-- migration, and resolve two schema-race conflicts that existed because
-- two different files each ran CREATE TABLE IF NOT EXISTS for the same
-- table name with different column sets — whichever ran first on a given
-- database "won", silently, and other routes could break depending on
-- which one that was:
--
--   school_bus_trips: fleet-positions/route.ts's version lacked trip_code,
--   route_code, students_dropped, duration_min, avg_speed_kmh,
--   max_speed_kmh, speeding_events, harsh_braking, geofence_exits, which
--   school-bus/trips/route.ts, trips/seed/route.ts and driver-scores/route.ts
--   all depend on. Resolved with ADD COLUMN IF NOT EXISTS for the full
--   superset — safe regardless of which variant is currently live.
--   scheduled_start's type (TIME vs TIMESTAMPTZ across the two variants)
--   is deliberately left untouched: changing an existing column's type
--   without knowing which one is live risks a failed migration or data
--   loss, and neither ensureTable() ever attempted it either.
--
--   school_bus_students: attendance/route.ts's version lacked deleted_at,
--   the route_id -> bus_routes FK, and the partial unique index on
--   student_code that students/route.ts's version has. Resolved the same
--   way — additive columns/index only, FK left for a follow-up since
--   retrofitting it could fail against any existing orphaned route_id.
--
-- Neither table had a tenant_id column in EITHER of their competing
-- definitions — a students PII table (names, DOB, guardian phone/email,
-- medical notes) had zero tenant isolation. Added nullable here like the
-- other bare tables in this batch.

CREATE TABLE IF NOT EXISTS school_bus_allocations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT        NOT NULL DEFAULT 'default',
  allocation_no       TEXT        NOT NULL,
  student_id          UUID,
  student_name        TEXT        NOT NULL,
  student_grade       TEXT,
  student_section     TEXT,
  student_emirates_id TEXT,
  parent_name         TEXT,
  parent_phone        TEXT,
  parent_email        TEXT,
  route_id            UUID,
  route_name          TEXT,
  pickup_stop_id      UUID,
  pickup_stop_name    TEXT,
  pickup_stop_time    TIME,
  drop_stop_id        UUID,
  drop_stop_name      TEXT,
  drop_stop_time      TIME,
  bus_mode            TEXT        NOT NULL DEFAULT 'TWO_WAY',
  seat_number         INT,
  effective_from      DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to        DATE,
  status              TEXT        NOT NULL DEFAULT 'ACTIVE',
  suspension_reason   TEXT,
  withdrawal_reason   TEXT,
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sba_alloc_no ON school_bus_allocations(allocation_no, tenant_id);
CREATE INDEX IF NOT EXISTS idx_sba_student  ON school_bus_allocations(student_id);
CREATE INDEX IF NOT EXISTS idx_sba_route    ON school_bus_allocations(route_id);
CREATE INDEX IF NOT EXISTS idx_sba_status   ON school_bus_allocations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sba_stop_pu  ON school_bus_allocations(pickup_stop_id);

-- Canonical school_bus_students schema = students/route.ts's fuller version.
CREATE TABLE IF NOT EXISTS school_bus_students (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_code  TEXT        NOT NULL,
  first_name    TEXT        NOT NULL,
  last_name     TEXT        NOT NULL,
  date_of_birth DATE,
  grade         TEXT,
  section       TEXT,
  school_name   TEXT,
  route_id      UUID,
  pickup_stop   TEXT,
  dropoff_stop  TEXT,
  rfid_card     TEXT,
  guardian1_name  TEXT,
  guardian1_phone TEXT,
  guardian1_email TEXT,
  guardian2_name  TEXT,
  guardian2_phone TEXT,
  guardian2_email TEXT,
  medical_notes   TEXT,
  photo_url       TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  enrollment_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Additive columns for installs where attendance/route.ts's thinner
-- variant ran first.
ALTER TABLE school_bus_students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE school_bus_students ADD COLUMN IF NOT EXISTS tenant_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_bus_students_code
  ON school_bus_students(student_code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS school_bus_attendance (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID        NOT NULL REFERENCES school_bus_students(id) ON DELETE CASCADE,
  date         DATE        NOT NULL DEFAULT CURRENT_DATE,
  session_type TEXT        NOT NULL DEFAULT 'MORNING',
  status       TEXT        NOT NULL DEFAULT 'ABSENT',
  scanned_at   TIMESTAMPTZ,
  boarded_at   TIMESTAMPTZ,
  dropped_at   TIMESTAMPTZ,
  trip_id      UUID,
  marked_by    TEXT,
  notes        TEXT,
  notified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, date, session_type)
);
CREATE INDEX IF NOT EXISTS idx_sba_date_route ON school_bus_attendance(date);
ALTER TABLE school_bus_attendance ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE TABLE IF NOT EXISTS school_bus_attendants (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT        NOT NULL DEFAULT 'default',
  employee_id         TEXT        NOT NULL,
  first_name          TEXT        NOT NULL,
  last_name           TEXT        NOT NULL,
  gender              TEXT        NOT NULL DEFAULT 'Female',
  nationality         TEXT,
  phone               TEXT,
  email               TEXT,
  emirates_id         TEXT,
  emirates_id_expiry  DATE,
  certification_no    TEXT,
  certification_expiry DATE,
  photo_url           TEXT,
  route_id            UUID,
  route_name          TEXT,
  assigned_vehicle_id TEXT,
  status              TEXT        NOT NULL DEFAULT 'ACTIVE',
  joining_date        DATE,
  notes               TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sba_emp_id ON school_bus_attendants(employee_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_sba_tenant ON school_bus_attendants(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sba_route ON school_bus_attendants(route_id);

CREATE TABLE IF NOT EXISTS school_bus_driver_scores (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT        NOT NULL DEFAULT 'default',
  driver_id           TEXT,
  driver_name         TEXT        NOT NULL,
  period              TEXT        NOT NULL,
  trips_total         INT         NOT NULL DEFAULT 0,
  trips_completed     INT         NOT NULL DEFAULT 0,
  total_distance_km   DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_students      INT         NOT NULL DEFAULT 0,
  speeding_events     INT         NOT NULL DEFAULT 0,
  harsh_braking       INT         NOT NULL DEFAULT 0,
  geofence_exits      INT         NOT NULL DEFAULT 0,
  incidents           INT         NOT NULL DEFAULT 0,
  late_departures     INT         NOT NULL DEFAULT 0,
  raw_score           INT         NOT NULL DEFAULT 100,
  rag_status          TEXT        NOT NULL DEFAULT 'GREEN',
  prev_score          INT,
  score_delta         INT,
  manual_override     BOOLEAN     NOT NULL DEFAULT false,
  override_reason     TEXT,
  override_by         TEXT,
  notes               TEXT,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sbds_driver_period ON school_bus_driver_scores(driver_id, period, tenant_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sbds_tenant ON school_bus_driver_scores(tenant_id, period);
CREATE INDEX IF NOT EXISTS idx_sbds_rag ON school_bus_driver_scores(rag_status, period);

CREATE TABLE IF NOT EXISTS school_bus_vehicle_positions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL DEFAULT 'default',
  vehicle_id      TEXT        NOT NULL,
  vehicle_plate   TEXT,
  route_id        UUID,
  route_name      TEXT,
  trip_id         UUID,
  driver_id       TEXT,
  driver_name     TEXT,
  attendant_id    UUID,
  attendant_name  TEXT,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  speed_kmh       DOUBLE PRECISION NOT NULL DEFAULT 0,
  heading_deg     INT         NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'EN_ROUTE',
  next_stop_name  TEXT,
  next_stop_eta   TIMESTAMPTZ,
  students_onboard INT        NOT NULL DEFAULT 0,
  last_ping_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sbvp_vehicle ON school_bus_vehicle_positions(vehicle_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_sbvp_tenant ON school_bus_vehicle_positions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sbvp_route ON school_bus_vehicle_positions(route_id);

-- Canonical school_bus_trips schema = trips/route.ts's & trips/seed's fuller
-- version (identical to each other); fleet-positions/route.ts's thinner
-- variant gets the missing columns added additively below.
CREATE TABLE IF NOT EXISTS school_bus_trips (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT        NOT NULL DEFAULT 'default',
  trip_code        TEXT,
  route_id         UUID,
  route_name       TEXT,
  route_code       TEXT,
  vehicle_id       TEXT,
  vehicle_plate    TEXT,
  driver_id        TEXT,
  driver_name      TEXT,
  attendant_id     UUID,
  attendant_name   TEXT,
  direction        TEXT        NOT NULL DEFAULT 'PICKUP',
  session          TEXT        NOT NULL DEFAULT 'MORNING',
  scheduled_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  scheduled_start  TIME,
  actual_start     TIMESTAMPTZ,
  actual_end       TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'SCHEDULED',
  students_total   INT         NOT NULL DEFAULT 0,
  students_boarded INT         NOT NULL DEFAULT 0,
  students_dropped INT         NOT NULL DEFAULT 0,
  stops_total      INT         NOT NULL DEFAULT 0,
  stops_completed  INT         NOT NULL DEFAULT 0,
  distance_km      DOUBLE PRECISION,
  duration_min     INT,
  avg_speed_kmh    DOUBLE PRECISION,
  max_speed_kmh    DOUBLE PRECISION,
  speeding_events  INT         NOT NULL DEFAULT 0,
  harsh_braking    INT         NOT NULL DEFAULT 0,
  geofence_exits   INT         NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Additive columns for installs where fleet-positions/route.ts's thinner
-- variant (no trip_code/route_code/students_dropped/duration_min/
-- avg_speed_kmh/max_speed_kmh/speeding_events/harsh_braking/geofence_exits)
-- ran first.
ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS trip_code TEXT;
ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS route_code TEXT;
ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS students_dropped INT NOT NULL DEFAULT 0;
ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS duration_min INT;
ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS avg_speed_kmh DOUBLE PRECISION;
ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS max_speed_kmh DOUBLE PRECISION;
ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS speeding_events INT NOT NULL DEFAULT 0;
ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS harsh_braking INT NOT NULL DEFAULT 0;
ALTER TABLE school_bus_trips ADD COLUMN IF NOT EXISTS geofence_exits INT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_sbt2_tenant ON school_bus_trips(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sbt2_date   ON school_bus_trips(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_sbt2_route  ON school_bus_trips(route_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sbt2_code ON school_bus_trips(trip_code, tenant_id) WHERE trip_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS school_bus_trip_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL DEFAULT 'default',
  trip_id       UUID        NOT NULL,
  event_type    TEXT        NOT NULL,
  event_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  speed_kmh     DOUBLE PRECISION,
  stop_id       UUID,
  stop_name     TEXT,
  student_id    UUID,
  student_name  TEXT,
  students_count INT,
  description   TEXT,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sbte_trip   ON school_bus_trip_events(trip_id, event_time);
CREATE INDEX IF NOT EXISTS idx_sbte_tenant ON school_bus_trip_events(tenant_id, event_time);

CREATE TABLE IF NOT EXISTS school_bus_schedules (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT        NOT NULL DEFAULT 'default',
  schedule_name       TEXT        NOT NULL,
  route_id            UUID,
  route_name          TEXT,
  route_code          TEXT,
  vehicle_id          TEXT,
  vehicle_plate       TEXT,
  driver_id           TEXT,
  driver_name         TEXT,
  attendant_id        UUID,
  attendant_name      TEXT,
  week_type           TEXT        NOT NULL DEFAULT 'MON_THU',
  active_days         JSONB       NOT NULL DEFAULT '["SUN","MON","TUE","WED","THU"]',
  session             TEXT        NOT NULL DEFAULT 'MORNING',
  direction           TEXT        NOT NULL DEFAULT 'PICKUP',
  departure_time      TIME        NOT NULL,
  arrival_time        TIME,
  effective_from      DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to        DATE,
  exception_dates     JSONB       NOT NULL DEFAULT '[]',
  override_dates      JSONB       NOT NULL DEFAULT '[]',
  status              TEXT        NOT NULL DEFAULT 'ACTIVE',
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sbsch_tenant ON school_bus_schedules(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sbsch_route  ON school_bus_schedules(route_id);
CREATE INDEX IF NOT EXISTS idx_sbsch_week   ON school_bus_schedules(week_type, session);

CREATE TABLE IF NOT EXISTS school_bus_stops (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT        NOT NULL DEFAULT 'default',
  stop_code        TEXT        NOT NULL,
  stop_name        TEXT        NOT NULL,
  emirate          TEXT        NOT NULL DEFAULT 'Dubai',
  city             TEXT,
  area             TEXT,
  neighbourhood    TEXT,
  landmark         TEXT,
  lat              DECIMAL(10,8),
  lng              DECIMAL(11,8),
  geofence_radius_m INT        NOT NULL DEFAULT 100,
  route_ids        JSONB       NOT NULL DEFAULT '[]',
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sbs_code ON school_bus_stops(stop_code);
CREATE INDEX IF NOT EXISTS idx_sbs_tenant ON school_bus_stops(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sbs_emirate ON school_bus_stops(emirate, city, area);

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'school_bus_allocations'],
    ARRAY['public', 'school_bus_students'],
    ARRAY['public', 'school_bus_attendance'],
    ARRAY['public', 'school_bus_attendants'],
    ARRAY['public', 'school_bus_driver_scores'],
    ARRAY['public', 'school_bus_vehicle_positions'],
    ARRAY['public', 'school_bus_trips'],
    ARRAY['public', 'school_bus_trip_events'],
    ARRAY['public', 'school_bus_schedules'],
    ARRAY['public', 'school_bus_stops']
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
