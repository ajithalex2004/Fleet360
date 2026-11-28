-- Field Service Management (Phase 1 — PR 2):
--   1. Additive Parent/Child Service Order & execution milestone columns on service_tickets
--   2. fsm_work_visits        — multi-visit appointments, arrival windows, GPS check-in & completion
--   3. fsm_visit_crew         — multi-technician crew (lead, helpers, supervisors) per visit
--   4. fsm_work_tasks         — standalone work order sub-tasks & non-job technician Gantt activities
--   5. fsm_visit_time_logs    — granular travel / wrench / break / waiting time tracking
--   6. fsm_checklist_templates & fsm_checklist_runs — SOP / Safety / QA digital checklists
--   7. fsm_service_reports    — signed Field Service Reports (FSR) with e-signatures & photos
--   8. fsm_mobile_sync_events — idempotency ledger for offline-first technician mobile sync
--
-- Additive only: existing rows and tickets remain untouched.

-- ── 1. Additive columns on service_tickets ───────────────────────────────────
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS parent_ticket_id       UUID REFERENCES service_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_start_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_end_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_route_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_on_site_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS work_started_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_time_fix         BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_service_tickets_parent
  ON service_tickets (tenant_id, parent_ticket_id)
  WHERE parent_ticket_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_tickets_dispatch_window
  ON service_tickets (tenant_id, scheduled_start_at, status)
  WHERE deleted_at IS NULL;

-- ── 2. Scheduled Field Visits ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_work_visits (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                TEXT          NOT NULL,
  ticket_id                UUID          NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  visit_number             SMALLINT      NOT NULL DEFAULT 1,
  team_id                  UUID          REFERENCES fsm_teams(id) ON DELETE SET NULL,
  status                   TEXT          NOT NULL DEFAULT 'SCHEDULED'
                             CHECK (status IN (
                               'SCHEDULED', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE',
                               'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'INCOMPLETE', 'CANCELLED'
                             )),
  scheduled_start_at       TIMESTAMPTZ   NOT NULL,
  scheduled_end_at         TIMESTAMPTZ   NOT NULL,
  arrival_window_start     TIMESTAMPTZ,
  arrival_window_end       TIMESTAMPTZ,
  estimated_duration_mins  INTEGER       NOT NULL DEFAULT 60 CHECK (estimated_duration_mins BETWEEN 5 AND 1440),
  actual_travel_mins       INTEGER       NOT NULL DEFAULT 0,
  actual_work_mins         INTEGER       NOT NULL DEFAULT 0,
  en_route_at              TIMESTAMPTZ,
  arrived_at               TIMESTAMPTZ,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  checkin_lat              NUMERIC(10,7),
  checkin_lng              NUMERIC(10,7),
  checkin_distance_m       INTEGER,
  geofence_override_reason TEXT,
  scanned_asset_tag        TEXT,
  resolution_summary       TEXT,
  incomplete_reason        TEXT,
  dispatch_notes           TEXT,
  created_by               TEXT,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_fsm_visit_window CHECK (scheduled_end_at > scheduled_start_at),
  CONSTRAINT uq_fsm_visit_ticket_num UNIQUE (tenant_id, ticket_id, visit_number)
);
CREATE INDEX IF NOT EXISTS idx_fsm_work_visits_window
  ON fsm_work_visits (tenant_id, scheduled_start_at, scheduled_end_at);
CREATE INDEX IF NOT EXISTS idx_fsm_work_visits_ticket
  ON fsm_work_visits (tenant_id, ticket_id, status);

-- ── 3. Multi-Technician Visit Crew ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_visit_crew (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT          NOT NULL,
  visit_id        UUID          NOT NULL REFERENCES fsm_work_visits(id) ON DELETE CASCADE,
  technician_id   UUID          NOT NULL REFERENCES fsm_technicians(id) ON DELETE CASCADE,
  role            TEXT          NOT NULL DEFAULT 'LEAD' CHECK (role IN ('LEAD', 'HELPER', 'SUPERVISOR')),
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_fsm_visit_crew UNIQUE (tenant_id, visit_id, technician_id)
);
CREATE INDEX IF NOT EXISTS idx_fsm_visit_crew_tech
  ON fsm_visit_crew (tenant_id, technician_id);

-- ── 4. Standalone Work Order Sub-Tasks & Non-Job Technician Activities ───────
CREATE TABLE IF NOT EXISTS fsm_work_tasks (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT          NOT NULL,
  ticket_id           UUID          REFERENCES service_tickets(id) ON DELETE CASCADE,
  visit_id            UUID          REFERENCES fsm_work_visits(id) ON DELETE SET NULL,
  depends_on_task_id  UUID          REFERENCES fsm_work_tasks(id) ON DELETE SET NULL,
  task_category       TEXT          NOT NULL DEFAULT 'WORK_ORDER_TASK'
                        CHECK (task_category IN (
                          'WORK_ORDER_TASK', 'PERMIT', 'SITE_SURVEY', 'PARTS_PICKUP', 'MEETING', 'TRAINING'
                        )),
  title               TEXT          NOT NULL,
  description         TEXT,
  assigned_tech_id    UUID          REFERENCES fsm_technicians(id) ON DELETE SET NULL,
  assigned_user_email TEXT,
  status              TEXT          NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED')),
  due_at              TIMESTAMPTZ,
  scheduled_start_at  TIMESTAMPTZ,
  scheduled_end_at    TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  sort_order          SMALLINT      NOT NULL DEFAULT 10,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fsm_work_tasks_ticket
  ON fsm_work_tasks (tenant_id, ticket_id, status);
CREATE INDEX IF NOT EXISTS idx_fsm_work_tasks_tech_window
  ON fsm_work_tasks (tenant_id, assigned_tech_id, scheduled_start_at);

-- ── 5. Granular Visit Time Logs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_visit_time_logs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT          NOT NULL,
  visit_id        UUID          NOT NULL REFERENCES fsm_work_visits(id) ON DELETE CASCADE,
  technician_id   UUID          NOT NULL REFERENCES fsm_technicians(id) ON DELETE CASCADE,
  log_type        TEXT          NOT NULL CHECK (log_type IN ('TRAVEL', 'WORK', 'BREAK', 'WAITING')),
  started_at      TIMESTAMPTZ   NOT NULL,
  ended_at        TIMESTAMPTZ,
  duration_mins   INTEGER,
  billable        BOOLEAN       NOT NULL DEFAULT TRUE,
  idempotency_key UUID,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsm_timelog_idemp
  ON fsm_visit_time_logs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_timelog_visit
  ON fsm_visit_time_logs (tenant_id, visit_id, started_at);

-- ── 6. Digital Checklist Templates & Executions ──────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_checklist_templates (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT          NOT NULL,
  code             TEXT          NOT NULL,
  name             TEXT          NOT NULL,
  checklist_type   TEXT          NOT NULL DEFAULT 'JOB_SOP'
                     CHECK (checklist_type IN ('PRE_WORK_SAFETY', 'JOB_SOP', 'QA_INSPECTION', 'HANDOVER')),
  service_type_key TEXT,
  is_mandatory     BOOLEAN       NOT NULL DEFAULT TRUE,
  items            JSONB         NOT NULL DEFAULT '[]'::jsonb,
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsm_chk_tpl_code
  ON fsm_checklist_templates (tenant_id, code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fsm_checklist_runs (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT          NOT NULL,
  ticket_id         UUID          NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  visit_id          UUID          REFERENCES fsm_work_visits(id) ON DELETE CASCADE,
  template_id       UUID          REFERENCES fsm_checklist_templates(id) ON DELETE SET NULL,
  template_name     TEXT          NOT NULL,
  checklist_type    TEXT          NOT NULL DEFAULT 'JOB_SOP',
  responses         JSONB         NOT NULL DEFAULT '[]'::jsonb,
  status            TEXT          NOT NULL DEFAULT 'IN_PROGRESS'
                      CHECK (status IN ('IN_PROGRESS', 'PASSED', 'FAILED')),
  completed_by      UUID          REFERENCES fsm_technicians(id) ON DELETE SET NULL,
  completed_at      TIMESTAMPTZ,
  idempotency_key   UUID,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsm_chk_run_idemp
  ON fsm_checklist_runs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_chk_runs_ticket
  ON fsm_checklist_runs (tenant_id, ticket_id, visit_id);

-- ── 7. Signed Field Service Reports (FSR) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_service_reports (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                TEXT          NOT NULL,
  report_number            TEXT          NOT NULL,
  ticket_id                UUID          NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
  visit_id                 UUID          REFERENCES fsm_work_visits(id) ON DELETE SET NULL,
  work_performed           TEXT          NOT NULL,
  root_cause_code          TEXT,
  remedy_code              TEXT,
  recommendations          TEXT,
  before_photo_urls        TEXT[]        NOT NULL DEFAULT '{}',
  after_photo_urls         TEXT[]        NOT NULL DEFAULT '{}',
  customer_signer_name     TEXT,
  customer_signer_title    TEXT,
  customer_signature_url   TEXT,
  technician_signature_url TEXT,
  signed_at                TIMESTAMPTZ,
  pdf_storage_key          TEXT,
  emailed_to               TEXT[],
  idempotency_key          UUID,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsm_fsr_number
  ON fsm_service_reports (tenant_id, report_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fsm_fsr_idemp
  ON fsm_service_reports (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_fsr_ticket
  ON fsm_service_reports (tenant_id, ticket_id, created_at DESC);

-- ── 8. Offline Mobile Sync Idempotency Ledger ────────────────────────────────
CREATE TABLE IF NOT EXISTS fsm_mobile_sync_events (
  tenant_id        TEXT          NOT NULL,
  idempotency_key  UUID          NOT NULL,
  technician_id    UUID          REFERENCES fsm_technicians(id) ON DELETE SET NULL,
  event_type       TEXT          NOT NULL,
  visit_id         UUID,
  response_status  SMALLINT      NOT NULL DEFAULT 200,
  response_body    JSONB,
  processed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

-- ── 9. Row-Level Security & Runtime Role Grants ──────────────────────────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'fsm_work_visits',
    'fsm_visit_crew',
    'fsm_work_tasks',
    'fsm_visit_time_logs',
    'fsm_checklist_templates',
    'fsm_checklist_runs',
    'fsm_service_reports',
    'fsm_mobile_sync_events'
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
