-- Field Service Management (Phase 1 — PR 1):
--   1. fsm_territories            — geographic service zones
--   2. fsm_technicians            — technician roster, rates, capacity & availability
--   3. fsm_teams / fsm_team_members — persistent named squads & team leads
--   4. fsm_technician_skills      — trades, proficiency & expiring certifications
--   5. fsm_technician_territories — technician-to-territory mapping
--   6. fsm_technician_shifts      — shifts, on-call windows, leave & training blocks
--   7. fsm_technician_locations   — latest GPS heartbeat per technician
--   8. fsm_user_territory_scopes  — granular FSM RBAC scoped by territory / team
--   9. Additive nullable columns on service_tickets (primary_technician_id,
--      assigned_team_id, territory_id) keeping assigned_to 100% backward compatible.
--
-- Additive only: existing rows and tickets remain untouched.

-- ── 1. Service Territories ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_territories (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT          NOT NULL,
  code            TEXT          NOT NULL,
  name            TEXT          NOT NULL,
  city            TEXT,
  center_lat      NUMERIC(10,7),
  center_lng      NUMERIC(10,7),
  radius_km       NUMERIC(6,2),
  polygon_geojson JSONB,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsm_territories_tenant_code
  ON fsm_territories (tenant_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_territories_tenant_active
  ON fsm_territories (tenant_id, is_active) WHERE deleted_at IS NULL;

-- ── 2. Technician Roster ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_technicians (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              TEXT          NOT NULL,
  user_id                TEXT,
  employee_code          TEXT          NOT NULL,
  full_name              TEXT          NOT NULL,
  email                  TEXT          NOT NULL,
  mobile                 TEXT,
  photo_url              TEXT,
  primary_department     TEXT          NOT NULL DEFAULT 'OPERATIONS_TRIAGE',
  employment_type        TEXT          NOT NULL DEFAULT 'INTERNAL'
                           CHECK (employment_type IN ('INTERNAL', 'CONTRACTOR')),
  contractor_partner_id  TEXT,
  home_base_address      TEXT,
  home_base_lat          NUMERIC(10,7),
  home_base_lng          NUMERIC(10,7),
  assigned_vehicle_id    TEXT,
  hourly_cost_rate       NUMERIC(12,2) NOT NULL DEFAULT 0,
  hourly_billable_rate   NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency               TEXT          NOT NULL DEFAULT 'AED',
  max_daily_jobs         INTEGER       NOT NULL DEFAULT 8 CHECK (max_daily_jobs BETWEEN 1 AND 50),
  availability_status    TEXT          NOT NULL DEFAULT 'AVAILABLE'
                           CHECK (availability_status IN ('AVAILABLE', 'ON_JOB', 'EN_ROUTE', 'ON_BREAK', 'OFF_SHIFT', 'ON_LEAVE')),
  is_active              BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsm_technicians_tenant_code
  ON fsm_technicians (tenant_id, employee_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_technicians_tenant_active
  ON fsm_technicians (tenant_id, primary_department) WHERE deleted_at IS NULL AND is_active;
CREATE INDEX IF NOT EXISTS idx_fsm_technicians_tenant_user
  ON fsm_technicians (tenant_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;

-- ── 3. Persistent Named Teams / Squads ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_teams (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT          NOT NULL,
  code                TEXT          NOT NULL,
  name                TEXT          NOT NULL,
  department_key      TEXT          NOT NULL DEFAULT 'OPERATIONS_TRIAGE',
  territory_id        UUID          REFERENCES fsm_territories(id) ON DELETE SET NULL,
  lead_technician_id  UUID          REFERENCES fsm_technicians(id) ON DELETE SET NULL,
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsm_teams_tenant_code
  ON fsm_teams (tenant_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_teams_tenant_active
  ON fsm_teams (tenant_id, department_key) WHERE deleted_at IS NULL AND is_active;

CREATE TABLE IF NOT EXISTS fsm_team_members (
  tenant_id       TEXT          NOT NULL,
  team_id         UUID          NOT NULL REFERENCES fsm_teams(id) ON DELETE CASCADE,
  technician_id   UUID          NOT NULL REFERENCES fsm_technicians(id) ON DELETE CASCADE,
  role            TEXT          NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('LEAD', 'MEMBER')),
  joined_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, team_id, technician_id)
);
CREATE INDEX IF NOT EXISTS idx_fsm_team_members_tech
  ON fsm_team_members (tenant_id, technician_id);

-- ── 4. Skills, Trades & Expiring Certifications ─────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_technician_skills (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT          NOT NULL,
  technician_id        UUID          NOT NULL REFERENCES fsm_technicians(id) ON DELETE CASCADE,
  skill_code           TEXT          NOT NULL,
  skill_name           TEXT          NOT NULL,
  proficiency_level    SMALLINT      NOT NULL DEFAULT 2 CHECK (proficiency_level BETWEEN 1 AND 4),
  is_certification     BOOLEAN       NOT NULL DEFAULT FALSE,
  certificate_number   TEXT,
  issuing_authority    TEXT,
  issued_at            DATE,
  expires_at           DATE,
  document_url         TEXT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_fsm_tech_skill UNIQUE (tenant_id, technician_id, skill_code)
);
CREATE INDEX IF NOT EXISTS idx_fsm_tech_skills_lookup
  ON fsm_technician_skills (tenant_id, skill_code, expires_at);

-- ── 5. Technician Territory Mapping ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_technician_territories (
  tenant_id       TEXT          NOT NULL,
  technician_id   UUID          NOT NULL REFERENCES fsm_technicians(id) ON DELETE CASCADE,
  territory_id    UUID          NOT NULL REFERENCES fsm_territories(id) ON DELETE CASCADE,
  is_primary      BOOLEAN       NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tenant_id, technician_id, territory_id)
);
CREATE INDEX IF NOT EXISTS idx_fsm_tech_territories_zone
  ON fsm_technician_territories (tenant_id, territory_id);

-- ── 6. Shifts, On-Call Windows & Leave Blocks ───────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_technician_shifts (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT          NOT NULL,
  technician_id   UUID          NOT NULL REFERENCES fsm_technicians(id) ON DELETE CASCADE,
  entry_type      TEXT          NOT NULL CHECK (entry_type IN ('SHIFT', 'ON_CALL', 'LEAVE', 'TRAINING', 'BLOCKED')),
  starts_at       TIMESTAMPTZ   NOT NULL,
  ends_at         TIMESTAMPTZ   NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_fsm_shift_window CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_fsm_tech_shifts_window
  ON fsm_technician_shifts (tenant_id, technician_id, starts_at, ends_at);

-- ── 7. Latest Technician GPS Location ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_technician_locations (
  tenant_id       TEXT          NOT NULL,
  technician_id   UUID          PRIMARY KEY REFERENCES fsm_technicians(id) ON DELETE CASCADE,
  latitude        NUMERIC(10,7) NOT NULL,
  longitude       NUMERIC(10,7) NOT NULL,
  accuracy_m      NUMERIC(8,2),
  battery_pct     SMALLINT,
  recorded_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fsm_tech_loc_tenant
  ON fsm_technician_locations (tenant_id, updated_at DESC);

-- ── 8. Granular FSM RBAC & Territory / Team Scopes ──────────────────────────
CREATE TABLE IF NOT EXISTS fsm_user_territory_scopes (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT          NOT NULL,
  user_id         TEXT          NOT NULL,
  user_email      TEXT,
  user_name       TEXT,
  fsm_role        TEXT          NOT NULL CHECK (fsm_role IN (
                    'FSM_ADMIN', 'FSM_DISPATCHER', 'FSM_TEAM_LEAD',
                    'FSM_TECHNICIAN', 'FSM_COMMERCIAL_MANAGER', 'FSM_VIEWER'
                  )),
  territory_id    UUID          REFERENCES fsm_territories(id) ON DELETE CASCADE,
  team_id         UUID          REFERENCES fsm_teams(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsm_user_scope_expr
  ON fsm_user_territory_scopes (
    tenant_id,
    user_id,
    fsm_role,
    COALESCE(territory_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_fsm_user_scopes_lookup
  ON fsm_user_territory_scopes (tenant_id, user_id);

-- ── 9. Additive workforce columns on service_tickets ────────────────────────
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS primary_technician_id UUID REFERENCES fsm_technicians(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_team_id      UUID REFERENCES fsm_teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS territory_id          UUID REFERENCES fsm_territories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_tickets_primary_tech
  ON service_tickets (tenant_id, primary_technician_id)
  WHERE primary_technician_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_tickets_assigned_team
  ON service_tickets (tenant_id, assigned_team_id)
  WHERE assigned_team_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_tickets_territory
  ON service_tickets (tenant_id, territory_id)
  WHERE territory_id IS NOT NULL AND deleted_at IS NULL;

-- ── 10. Row-Level Security & Runtime Role Grants ────────────────────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'fsm_territories',
    'fsm_technicians',
    'fsm_teams',
    'fsm_team_members',
    'fsm_technician_skills',
    'fsm_technician_territories',
    'fsm_technician_shifts',
    'fsm_technician_locations',
    'fsm_user_territory_scopes'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL '
      'USING ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true))) '
      'WITH CHECK ((current_setting(''app.tenant_id'', true) = ''*'') OR (tenant_id = current_setting(''app.tenant_id'', true)))',
      tbl
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_api_role', tbl);
    END IF;
  END LOOP;
END $$;
