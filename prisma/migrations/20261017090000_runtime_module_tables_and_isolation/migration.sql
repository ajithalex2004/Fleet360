-- Tables of the AI agents, Fleet, Dispatch and hours-of-service modules, and
-- tenant isolation for the ones that never had any.
--
-- 1. Tables. These were only created at request time by ensureAgentSchema,
--    ensureFleetSchema, ensureDispatchSchema and ensureHosSchema. The runtime
--    role may not run DDL, so a fresh install never had them. The statements
--    below are copied verbatim from those files (all IF NOT EXISTS, plus one
--    ON CONFLICT DO NOTHING seed), so they are a no-op where the tables exist.
--
-- 2. Access. The runtime role gets table access, as
--    20261009090000_missing_module_tables gives the tables it creates.
--
-- 3. Isolation for the tables that had a tenant_id: the standard
--    tenant_isolation policy (identical to the one production already has
--    where 20260925130000_rls_for_unprotected_tenant_tables covered them).
--
-- 4. Isolation for 15 tables that had NO tenant_id and no RLS in production
--    (checked 2026-09-30), and whose queries have no tenant filter: every
--    tenant could read and change every other tenant's fleet work orders,
--    lifecycle events, allocations, transfers, insurance, ambulance
--    capabilities, HOS logs and violations, dispatch attempts, optimiser
--    recommendations, risk scores, coaching plans and triage assessments.
--    Each gets:
--      - tenant_id TEXT defaulting to the session's app.tenant_id, so every
--        existing INSERT records the caller's tenant without naming it;
--      - existing rows backfilled from the vehicle, driver, dispatch job or
--        incident they belong to (rows that cannot be traced stay NULL and
--        are then visible in platform context only);
--      - the standard tenant_isolation policy with RLS forced.
--    vehicle_types additionally keeps rows with no tenant readable by every
--    tenant (a shared catalogue); only a tenant's own types can be changed.
--
-- route_matrix_cache stays shared on purpose: travel times keyed by
-- geohash pairs, no tenant data.
--
-- Safe to re-run.

-- ── 1. AI agents (src/lib/agents/schema.ts) ──
CREATE SCHEMA IF NOT EXISTS ai;
CREATE TABLE IF NOT EXISTS agent_runs (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id                 TEXT NOT NULL,
    tenant_id                TEXT NOT NULL DEFAULT 'default',
    event_type               TEXT NOT NULL,
    entity_id                TEXT,
    input                    JSONB,
    output                   JSONB,
    risk_score               NUMERIC(5,3),
    action_taken             TEXT,
    items_processed          INT DEFAULT 0,
    actions_created          INT DEFAULT 0,
    duration_ms              INT,
    status                   TEXT NOT NULL DEFAULT 'COMPLETED',
    error_text               TEXT,
    model_alias              TEXT,
    model_provider           TEXT,
    input_tokens             INT DEFAULT 0,
    output_tokens            INT DEFAULT 0,
    cached_tokens            INT DEFAULT 0,
    tool_calls_count         INT DEFAULT 0,
    agent_hops_count         INT DEFAULT 0,
    matrix_elements_queried  INT DEFAULT 0,
    solver_duration_ms       INT DEFAULT 0,
    cost_usd                 NUMERIC(10,5) DEFAULT 0,
    cost_aed                 NUMERIC(10,4) DEFAULT 0,
    estimated_savings_aed    NUMERIC(12,2) DEFAULT 0,
    actual_savings_aed       NUMERIC(12,2) DEFAULT 0,
    business_outcome         TEXT,
    decision_quality_score   NUMERIC(5,3),
    human_feedback           TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model_alias TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS model_provider TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS input_tokens INT DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS output_tokens INT DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cached_tokens INT DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tool_calls_count INT DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS agent_hops_count INT DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS matrix_elements_queried INT DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS solver_duration_ms INT DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,5) DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cost_aed NUMERIC(10,4) DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS estimated_savings_aed NUMERIC(12,2) DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS actual_savings_aed NUMERIC(12,2) DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS business_outcome TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS decision_quality_score NUMERIC(5,3);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS human_feedback TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id   ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_id  ON agent_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_outcome    ON agent_runs(business_outcome);
CREATE TABLE IF NOT EXISTS agent_evaluation_metrics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            TEXT NOT NULL,
    tenant_id           TEXT NOT NULL DEFAULT 'default',
    run_id              UUID,
    entity_id           TEXT,
    metric_category     TEXT NOT NULL,
    metric_name         TEXT NOT NULL,
    metric_value        NUMERIC(10,4) NOT NULL,
    is_positive_outcome BOOLEAN NOT NULL DEFAULT true,
    notes               TEXT,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE INDEX IF NOT EXISTS idx_agent_eval_agent_id    ON agent_evaluation_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_eval_tenant_id   ON agent_evaluation_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_eval_category    ON agent_evaluation_metrics(metric_category);
CREATE INDEX IF NOT EXISTS idx_agent_eval_recorded_at ON agent_evaluation_metrics(recorded_at DESC);
CREATE TABLE IF NOT EXISTS agent_roi_metrics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           TEXT NOT NULL DEFAULT 'default',
    agent_id            TEXT NOT NULL,
    period_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    total_executions    INT NOT NULL DEFAULT 0,
    total_cost_usd      NUMERIC(10,4) NOT NULL DEFAULT 0,
    total_cost_aed      NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_savings_aed   NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_value_aed       NUMERIC(14,2) NOT NULL DEFAULT 0,
    roi_multiplier      NUMERIC(8,2) NOT NULL DEFAULT 0,
    acceptance_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 100.0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_agent_roi_tenant_agent_date UNIQUE (tenant_id, agent_id, period_date)
  );
CREATE INDEX IF NOT EXISTS idx_agent_roi_tenant ON agent_roi_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_roi_agent  ON agent_roi_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_roi_period ON agent_roi_metrics(period_date DESC);
CREATE TABLE IF NOT EXISTS route_matrix_cache (
    cache_key           TEXT PRIMARY KEY,
    origin_canonical_id TEXT,
    dest_canonical_id   TEXT,
    origin_geohash      TEXT NOT NULL,
    dest_geohash        TEXT NOT NULL,
    origin_lat          NUMERIC(9,6) NOT NULL,
    origin_lng          NUMERIC(9,6) NOT NULL,
    dest_lat            NUMERIC(9,6) NOT NULL,
    dest_lng            NUMERIC(9,6) NOT NULL,
    distance_km         NUMERIC(10,3) NOT NULL,
    duration_min        NUMERIC(8,2) NOT NULL,
    ttl_tier            TEXT NOT NULL DEFAULT 'HISTORICAL_TRAVEL_TIME',
    provider            TEXT NOT NULL DEFAULT 'google',
    hit_count           INT NOT NULL DEFAULT 1,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE INDEX IF NOT EXISTS idx_matrix_cache_origin_dest ON route_matrix_cache(origin_geohash, dest_geohash);
CREATE INDEX IF NOT EXISTS idx_matrix_cache_canonical   ON route_matrix_cache(origin_canonical_id, dest_canonical_id);
CREATE INDEX IF NOT EXISTS idx_matrix_cache_expires_at  ON route_matrix_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_matrix_cache_tier        ON route_matrix_cache(ttl_tier);
CREATE TABLE IF NOT EXISTS fleet_risk_scores (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id               TEXT NOT NULL,
    vehicle_code             TEXT,
    make                     TEXT,
    model                    TEXT,
    license_plate            TEXT,
    risk_score               NUMERIC(5,3) NOT NULL,
    risk_level               TEXT NOT NULL,
    factors                  JSONB NOT NULL DEFAULT '{}',
    recommended_action       TEXT NOT NULL,
    predicted_failure_window TEXT,
    auto_work_order_id       UUID,
    agent_run_id             UUID,
    scored_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fleet_risk_scores_vehicle_id_key UNIQUE (vehicle_id)
  );
CREATE INDEX IF NOT EXISTS idx_fleet_risk_scores_risk_level  ON fleet_risk_scores(risk_level);
CREATE INDEX IF NOT EXISTS idx_fleet_risk_scores_risk_score  ON fleet_risk_scores(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_risk_scores_scored_at   ON fleet_risk_scores(scored_at DESC);
CREATE TABLE IF NOT EXISTS ai.agent_anomaly_flags (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    detector_id   TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    severity      TEXT NOT NULL,
    confidence    NUMERIC(5,3) NOT NULL,
    explanation   TEXT NOT NULL,
    amount        NUMERIC(14,2),
    currency      TEXT DEFAULT 'AED',
    metadata      JSONB,
    status        TEXT NOT NULL DEFAULT 'OPEN',
    reviewed_by   TEXT,
    reviewed_at   TIMESTAMPTZ,
    agent_run_id  UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS stream_type TEXT;
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS expected_value TEXT;
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS actual_value TEXT;
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS variance_pct NUMERIC(8,2);
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS likely_cause TEXT;
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS financial_exposure_aed NUMERIC(14,2);
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS recommended_action JSONB;
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS action_taken TEXT;
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS action_taken_at TIMESTAMPTZ;
ALTER TABLE ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS action_taken_by TEXT;
CREATE INDEX IF NOT EXISTS idx_anomaly_flags_severity    ON ai.agent_anomaly_flags(severity);
CREATE INDEX IF NOT EXISTS idx_anomaly_flags_status      ON ai.agent_anomaly_flags(status);
CREATE INDEX IF NOT EXISTS idx_anomaly_flags_entity_type ON ai.agent_anomaly_flags(entity_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_flags_tenant_id   ON ai.agent_anomaly_flags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_flags_stream      ON ai.agent_anomaly_flags(stream_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_flags_created_at  ON ai.agent_anomaly_flags(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_flags_open_dedup
  ON ai.agent_anomaly_flags(entity_id, detector_id)
  WHERE status = 'OPEN';
CREATE TABLE IF NOT EXISTS bus_ops_plan_recommendations (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                  TEXT NOT NULL,
    plan_name                  TEXT NOT NULL,
    shift_coverage             JSONB NOT NULL DEFAULT '[]',
    total_employees_covered    INT NOT NULL DEFAULT 0,
    baseline_vehicles_needed   INT NOT NULL DEFAULT 0,
    optimized_vehicles_needed  INT NOT NULL DEFAULT 0,
    vehicles_saved             INT NOT NULL DEFAULT 0,
    daily_distance_saved_km    NUMERIC(10,2) NOT NULL DEFAULT 0,
    monthly_cost_saved_aed     NUMERIC(12,2) NOT NULL DEFAULT 0,
    annual_cost_saved_aed      NUMERIC(14,2) NOT NULL DEFAULT 0,
    routes                     JSONB NOT NULL DEFAULT '[]',
    vehicle_reuse_chains       JSONB NOT NULL DEFAULT '[]',
    status                     TEXT NOT NULL DEFAULT 'SUGGESTED',
    applied_at                 TIMESTAMPTZ,
    applied_by                 TEXT,
    agent_run_id               UUID,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE INDEX IF NOT EXISTS idx_bus_ops_plan_rec_tenant     ON bus_ops_plan_recommendations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_ops_plan_rec_status     ON bus_ops_plan_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_bus_ops_plan_rec_created_at ON bus_ops_plan_recommendations(created_at DESC);
CREATE TABLE IF NOT EXISTS route_optimisation_results (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id               UUID NOT NULL,
    route_name             TEXT,
    route_number           TEXT,
    original_stop_count    INT NOT NULL DEFAULT 0,
    matched_stop_count     INT NOT NULL DEFAULT 0,
    original_distance_km   NUMERIC(10,3) NOT NULL,
    optimised_distance_km  NUMERIC(10,3) NOT NULL,
    distance_saved_km      NUMERIC(10,3) NOT NULL,
    distance_saved_pct     NUMERIC(6,2) NOT NULL,
    iterations_2opt        INT NOT NULL DEFAULT 0,
    solver_duration_ms     INT NOT NULL DEFAULT 0,
    estimated_duration_min INT,
    original_sequence      JSONB NOT NULL DEFAULT '[]',
    optimised_sequence     JSONB NOT NULL DEFAULT '[]',
    status                 TEXT NOT NULL DEFAULT 'SUGGESTED',
    applied_at             TIMESTAMPTZ,
    rejected_at            TIMESTAMPTZ,
    rejected_by            TEXT,
    agent_run_id           UUID,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT route_optimisation_results_route_id_key UNIQUE (route_id)
  );
CREATE INDEX IF NOT EXISTS idx_route_opt_status     ON route_optimisation_results(status);
CREATE INDEX IF NOT EXISTS idx_route_opt_saved_pct  ON route_optimisation_results(distance_saved_pct DESC);
CREATE INDEX IF NOT EXISTS idx_route_opt_updated_at ON route_optimisation_results(updated_at DESC);
CREATE TABLE IF NOT EXISTS incident_triage_assessments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id         TEXT NOT NULL,
    incident_no         TEXT,
    incident_type       TEXT NOT NULL,
    reported_severity   TEXT NOT NULL,
    ai_severity         TEXT NOT NULL,
    severity_changed    BOOLEAN NOT NULL DEFAULT FALSE,
    triage_score        NUMERIC(5,3) NOT NULL,
    nearest_unit_id     TEXT,
    nearest_unit_code   TEXT,
    nearest_unit_eta_min INT,
    dispatch_priority   TEXT,
    ai_recommendation   TEXT,
    risk_factors        JSONB NOT NULL DEFAULT '[]',
    actions_suggested   JSONB NOT NULL DEFAULT '[]',
    status              TEXT NOT NULL DEFAULT 'PENDING',
    agent_run_id        UUID,
    assessed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE UNIQUE INDEX IF NOT EXISTS idx_incident_triage_incident_id ON incident_triage_assessments(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_triage_ai_severity ON incident_triage_assessments(ai_severity);
CREATE INDEX IF NOT EXISTS idx_incident_triage_assessed_at ON incident_triage_assessments(assessed_at DESC);
CREATE TABLE IF NOT EXISTS dispatch_optimiser_recommendations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              TEXT NOT NULL,
    job_service_type    TEXT,
    job_priority        TEXT,
    recommended_driver_id TEXT,
    recommended_vehicle_id TEXT,
    composite_score     NUMERIC(5,3) NOT NULL,
    factor_scores       JSONB NOT NULL DEFAULT '{}',
    candidates_evaluated INT NOT NULL DEFAULT 0,
    reason              TEXT,
    confidence          NUMERIC(5,3),
    status              TEXT NOT NULL DEFAULT 'SUGGESTED',
    applied_at          TIMESTAMPTZ,
    agent_run_id        UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT dispatch_opt_job_id_key UNIQUE (job_id)
  );
CREATE INDEX IF NOT EXISTS idx_dispatch_opt_status     ON dispatch_optimiser_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_opt_score      ON dispatch_optimiser_recommendations(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_opt_created_at ON dispatch_optimiser_recommendations(created_at DESC);
CREATE TABLE IF NOT EXISTS driver_coaching_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id           TEXT NOT NULL,
    driver_name         TEXT,
    week_label          TEXT NOT NULL,
    rag_score           NUMERIC(5,2),
    rag_trend           TEXT,
    overall_rating      TEXT NOT NULL,
    focus_areas         JSONB NOT NULL DEFAULT '[]',
    coaching_plan       TEXT NOT NULL,
    kpis                JSONB NOT NULL DEFAULT '{}',
    violations_count    INT NOT NULL DEFAULT 0,
    fuel_score          NUMERIC(5,2),
    speed_score         NUMERIC(5,2),
    safety_score        NUMERIC(5,2),
    status              TEXT NOT NULL DEFAULT 'DRAFT',
    sent_at             TIMESTAMPTZ,
    agent_run_id        UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE INDEX IF NOT EXISTS idx_coaching_driver_id  ON driver_coaching_plans(driver_id);
CREATE INDEX IF NOT EXISTS idx_coaching_week_label ON driver_coaching_plans(week_label);
CREATE INDEX IF NOT EXISTS idx_coaching_created_at ON driver_coaching_plans(created_at DESC);
CREATE TABLE IF NOT EXISTS demand_forecasts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           TEXT NOT NULL DEFAULT 'default',
    forecast_period     TEXT NOT NULL,
    vehicle_type        TEXT,
    branch_id           TEXT,
    segment             TEXT NOT NULL DEFAULT 'ALL',
    historical_avg      NUMERIC(10,2),
    forecast_value      NUMERIC(10,2) NOT NULL,
    confidence_interval_low  NUMERIC(10,2),
    confidence_interval_high NUMERIC(10,2),
    trend_direction     TEXT NOT NULL DEFAULT 'STABLE',
    seasonality_factor  NUMERIC(5,3),
    holiday_adjustment  NUMERIC(5,3),
    recommended_fleet_size INT,
    repositioning_actions JSONB NOT NULL DEFAULT '[]',
    narrative           TEXT,
    model_used          TEXT NOT NULL DEFAULT 'MOVING_AVG_TREND',
    agent_run_id        UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT demand_forecasts_period_segment_key UNIQUE (tenant_id, forecast_period, segment, vehicle_type, branch_id)
  );
CREATE INDEX IF NOT EXISTS idx_demand_tenant   ON demand_forecasts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_demand_period   ON demand_forecasts(forecast_period);
CREATE INDEX IF NOT EXISTS idx_demand_segment  ON demand_forecasts(segment);
CREATE INDEX IF NOT EXISTS idx_demand_created  ON demand_forecasts(created_at DESC);
CREATE TABLE IF NOT EXISTS tenant_ai_policies (
    tenant_id                             TEXT PRIMARY KEY,
    max_autonomy_level                    TEXT NOT NULL DEFAULT 'L3',
    daily_budget_aed                      NUMERIC(10,2) NOT NULL DEFAULT 200.00,
    monthly_budget_aed                    NUMERIC(10,2) NOT NULL DEFAULT 5000.00,
    require_human_approval_threshold_aed  NUMERIC(10,2) NOT NULL DEFAULT 500.00,
    disabled_agents                       JSONB NOT NULL DEFAULT '[]'::jsonb,
    circuit_breaker_triggered             BOOLEAN NOT NULL DEFAULT false,
    updated_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS agent_approvals (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            TEXT NOT NULL DEFAULT 'default',
    agent_id             TEXT NOT NULL,
    entity_type          TEXT NOT NULL,
    entity_id            TEXT NOT NULL,
    action_type          TEXT NOT NULL,
    title                TEXT NOT NULL,
    description          TEXT NOT NULL,
    financial_impact_aed NUMERIC(12,2) DEFAULT 0,
    proposed_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    status               TEXT NOT NULL DEFAULT 'PENDING',
    requested_autonomy   TEXT NOT NULL DEFAULT 'L3',
    reviewed_by          TEXT,
    reviewed_at          TIMESTAMPTZ,
    review_notes         TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE INDEX IF NOT EXISTS idx_agent_approvals_tenant_status ON agent_approvals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_agent_id      ON agent_approvals(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_created_at    ON agent_approvals(created_at DESC);
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      TEXT NOT NULL DEFAULT 'default',
    direction      TEXT NOT NULL,
    from_number    TEXT NOT NULL,
    to_number      TEXT NOT NULL,
    message_body   TEXT NOT NULL,
    message_sid    TEXT,
    status         TEXT NOT NULL DEFAULT 'RECEIVED',
    message_type   TEXT NOT NULL DEFAULT 'TEXT',
    template_name  TEXT,
    module         TEXT NOT NULL DEFAULT 'GENERAL',
    intent         TEXT NOT NULL DEFAULT 'GENERAL',
    auto_replied   BOOLEAN NOT NULL DEFAULT false,
    raw_payload    JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant     ON whatsapp_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_from       ON whatsapp_messages(from_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_at ON whatsapp_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_direction  ON whatsapp_messages(direction);
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name  TEXT NOT NULL UNIQUE,
    body_en        TEXT NOT NULL,
    body_ar        TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    usage_count    INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
INSERT INTO whatsapp_templates (template_name, display_name, category, language, body_en, body_ar) VALUES
    ('auto_reply_inquiry', 'Auto-Reply: Inquiry', 'AUTO_REPLY', 'en',
     'Thanks for reaching out to Fleet360! For vehicle availability, pricing, or booking a rental, one of our team will follow up shortly. You can also call our hotline for immediate assistance.',
     'شكرًا لتواصلك مع Fleet360! بخصوص توفر المركبات أو الأسعار أو الحجز، سيتواصل معك أحد أفراد فريقنا قريبًا.'),
    ('auto_reply_payment', 'Auto-Reply: Payment', 'AUTO_REPLY', 'en',
     'Thanks for your message about billing or payment. Our finance team will review your account and get back to you shortly. For urgent payment queries, please call our support line.',
     'شكرًا لرسالتك بخصوص الفوترة أو الدفع. سيقوم فريق المالية لدينا بمراجعة حسابك والرد عليك قريبًا.'),
    ('auto_reply_renewal', 'Auto-Reply: Renewal', 'AUTO_REPLY', 'en',
     'Thanks for your interest in renewing or extending your contract. Our team will review your current agreement and reach out with renewal options shortly.',
     'شكرًا لاهتمامك بتجديد أو تمديد عقدك. سيقوم فريقنا بمراجعة اتفاقيتك الحالية والتواصل معك بخيارات التجديد قريبًا.'),
    ('auto_reply_general', 'Auto-Reply: General', 'AUTO_REPLY', 'en',
     'Thanks for contacting Fleet360! We''ve received your message and a member of our team will respond as soon as possible.',
     'شكرًا لتواصلك مع Fleet360! لقد استلمنا رسالتك وسيقوم أحد أفراد فريقنا بالرد عليك في أقرب وقت ممكن.')
  ON CONFLICT (template_name) DO NOTHING;
CREATE TABLE IF NOT EXISTS preventive_maintenance_forecasts (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                TEXT NOT NULL DEFAULT 'default',
    vehicle_id               TEXT NOT NULL,
    vehicle_code             TEXT,
    license_plate            TEXT,
    make                     TEXT,
    model                    TEXT,
    current_odometer_km      NUMERIC(10,2) NOT NULL,
    current_engine_hours     NUMERIC(10,2) NOT NULL DEFAULT 0,
    daily_avg_km             NUMERIC(8,2) NOT NULL DEFAULT 0,
    daily_avg_engine_hours   NUMERIC(8,2) NOT NULL DEFAULT 0,
    target_service_threshold TEXT NOT NULL,
    target_trigger_type      TEXT NOT NULL DEFAULT 'ODOMETER',
    remaining_km             NUMERIC(10,2),
    remaining_engine_hours   NUMERIC(10,2),
    estimated_days_to_due    INT NOT NULL,
    projected_due_date       DATE NOT NULL,
    urgency_level            TEXT NOT NULL DEFAULT 'UPCOMING',
    forecast_narrative       TEXT NOT NULL,
    recommended_slot         JSONB NOT NULL DEFAULT '{}'::jsonb,
    operational_impact_score NUMERIC(5,2) DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'ACTIVE',
    agent_run_id             UUID,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pm_forecasts_vehicle_uniq UNIQUE (tenant_id, vehicle_id)
  );
CREATE INDEX IF NOT EXISTS idx_pm_forecasts_tenant_urgency ON preventive_maintenance_forecasts(tenant_id, urgency_level);
CREATE INDEX IF NOT EXISTS idx_pm_forecasts_due_date ON preventive_maintenance_forecasts(projected_due_date);

-- ── 1. Fleet (src/lib/fleet/schema.ts) ──
CREATE TABLE IF NOT EXISTS vehicle_types (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    TEXT        NOT NULL,
    name                    TEXT        NOT NULL,
    make                    TEXT,
    model                   TEXT,
    description             TEXT,
    vehicle_group           TEXT,
    vehicle_class           TEXT,
    transmission_type       TEXT,
    fuel_type               TEXT,
    num_passengers          INT,
    max_speed_kmh           INT,
    fuel_efficiency_kml     NUMERIC(8,3),
    cost_per_km             NUMERIC(8,4),
    idle_fuel_consumption   NUMERIC(8,4),
    co2_emission_factor     NUMERIC(8,4),
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    notes                   TEXT,
    deleted_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS fleet_work_orders (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_number             TEXT        NOT NULL,
    vehicle_id            UUID,
    wo_type               TEXT,
    status                TEXT        NOT NULL DEFAULT 'OPEN',
    priority              TEXT,
    garage_name           TEXT,
    garage_contact        TEXT,
    assigned_to           TEXT,
    scheduled_date        TIMESTAMPTZ,
    start_date            TIMESTAMPTZ,
    end_date              TIMESTAMPTZ,
    odometer_at_entry     INT,
    authorized_po_amount  NUMERIC(12,2),
    actual_cost           NUMERIC(12,2),
    variance              NUMERIC(12,2),
    variance_alert        BOOLEAN     DEFAULT FALSE,
    description           TEXT,
    findings              TEXT,
    actions_taken         TEXT,
    line_items            JSONB,
    requested_by          TEXT,
    approved_by           TEXT,
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS fleet_lifecycle_events (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id    UUID,
    event_type    TEXT        NOT NULL,
    event_date    TIMESTAMPTZ,
    from_stage    TEXT,
    to_stage      TEXT,
    description   TEXT,
    reference_no  TEXT,
    performed_by  TEXT,
    cost          NUMERIC(14,2),
    metadata      JSONB,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS fleet_allocations (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id            UUID,
    allocated_to_type     TEXT,
    allocated_to_id       TEXT,
    allocated_to_name     TEXT,
    allocation_date       TIMESTAMPTZ,
    expected_return_date  TIMESTAMPTZ,
    actual_return_date    TIMESTAMPTZ,
    purpose               TEXT,
    authorized_by         TEXT,
    mileage_at_allocation INT,
    mileage_at_return     INT,
    status                TEXT        NOT NULL DEFAULT 'ACTIVE',
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS fleet_transfers (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_no             TEXT        NOT NULL,
    vehicle_id              UUID,
    from_branch_id          TEXT,
    from_branch_name        TEXT,
    to_branch_id            TEXT,
    to_branch_name          TEXT,
    transfer_date           TIMESTAMPTZ,
    requested_by            TEXT,
    reason                  TEXT,
    mileage_at_transfer     INT,
    fuel_level_at_transfer  TEXT,
    status                  TEXT        NOT NULL DEFAULT 'PENDING',
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS fleet_vehicle_insurance (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id              UUID,
    policy_number           TEXT,
    insurer                 TEXT,
    policy_type             TEXT,
    start_date              DATE,
    end_date                DATE,
    premium_amount          NUMERIC(12,2),
    coverage_amount         NUMERIC(14,2),
    deductible              NUMERIC(12,2),
    renewal_reminder_days   INT         DEFAULT 30,
    document_url            TEXT,
    status                  TEXT        NOT NULL DEFAULT 'ACTIVE',
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE INDEX IF NOT EXISTS idx_vt_code       ON vehicle_types(code);
CREATE INDEX IF NOT EXISTS idx_vt_group      ON vehicle_types(vehicle_group);
CREATE INDEX IF NOT EXISTS idx_vt_active     ON vehicle_types(is_active);
CREATE INDEX IF NOT EXISTS idx_fwo_vehicle    ON fleet_work_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fwo_status     ON fleet_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_fwo_priority   ON fleet_work_orders(priority);
CREATE INDEX IF NOT EXISTS idx_fwo_scheduled  ON fleet_work_orders(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_fwo_created    ON fleet_work_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fle_vehicle    ON fleet_lifecycle_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fle_event_type ON fleet_lifecycle_events(event_type);
CREATE INDEX IF NOT EXISTS idx_fle_event_date ON fleet_lifecycle_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_fa_vehicle     ON fleet_allocations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fa_status      ON fleet_allocations(status);
CREATE INDEX IF NOT EXISTS idx_fa_alloc_date  ON fleet_allocations(allocation_date DESC);
CREATE INDEX IF NOT EXISTS idx_ft_vehicle     ON fleet_transfers(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ft_status      ON fleet_transfers(status);
CREATE INDEX IF NOT EXISTS idx_ft_date        ON fleet_transfers(transfer_date DESC);
CREATE INDEX IF NOT EXISTS idx_fvi_vehicle    ON fleet_vehicle_insurance(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fvi_status     ON fleet_vehicle_insurance(status);
CREATE INDEX IF NOT EXISTS idx_fvi_end_date   ON fleet_vehicle_insurance(end_date);

-- ── 1. Dispatch (src/lib/dispatch/schema.ts) ──
CREATE TABLE IF NOT EXISTS dispatch_jobs (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           TEXT        NOT NULL,
    booking_id          TEXT,
    service_type        TEXT        NOT NULL,
    priority            TEXT        NOT NULL DEFAULT 'NORMAL',
    status              TEXT        NOT NULL DEFAULT 'PENDING',
    current_attempt     INT         NOT NULL DEFAULT 0,
    max_attempts        INT         NOT NULL DEFAULT 3,
    pickup_lat          DECIMAL(10,8),
    pickup_lng          DECIMAL(11,8),
    dropoff_lat         DECIMAL(10,8),
    dropoff_lng         DECIMAL(11,8),
    zone_id             TEXT,
    sla_deadline        TIMESTAMPTZ,
    assigned_driver_id  TEXT,
    assigned_vehicle_id TEXT,
    preempted_from_job  UUID,
    dispatch_score      DECIMAL(6,4),
    metadata            JSONB,
    escalated_at        TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
-- dispatch_job_id is TEXT here, not UUID as in src/lib/dispatch/schema.ts:
-- the key must match dispatch_jobs.id, which the migrations create as TEXT.
-- Where dispatch_attempts already exists (production) this is a no-op.
CREATE TABLE IF NOT EXISTS dispatch_attempts (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_job_id   TEXT        REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
    attempt_number    INT         NOT NULL,
    driver_id         TEXT,
    vehicle_id        TEXT,
    score             DECIMAL(6,4),
    distance_km       DECIMAL(8,2),
    eta_minutes       INT,
    offered_at        TIMESTAMPTZ,
    responded_at      TIMESTAMPTZ,
    response          TEXT,
    rejection_reason  TEXT,
    score_breakdown   JSONB,
    accept_token      TEXT        UNIQUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS dispatch_weights (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   TEXT,
    service_type                TEXT        NOT NULL,
    priority                    TEXT        NOT NULL DEFAULT 'NORMAL',
    weights                     JSONB       NOT NULL DEFAULT '{}',
    max_attempts                INT         NOT NULL DEFAULT 3,
    driver_response_timeout_min INT         NOT NULL DEFAULT 6,
    dispatch_radius_km          DECIMAL(8,2) NOT NULL DEFAULT 10,
    prefer_same_zone            BOOLEAN     NOT NULL DEFAULT TRUE,
    cross_zone_allowed          BOOLEAN     NOT NULL DEFAULT TRUE,
    allow_preemption            BOOLEAN     NOT NULL DEFAULT FALSE,
    preemptible_priorities      JSONB       DEFAULT '[]',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, service_type, priority)
  );
CREATE TABLE IF NOT EXISTS vehicle_locations (
    vehicle_id   TEXT        PRIMARY KEY,
    lat          DECIMAL(10,8) NOT NULL,
    lng          DECIMAL(11,8) NOT NULL,
    heading      DECIMAL(5,2),
    speed_kmh    DECIMAL(6,2),
    accuracy_m   DECIMAL(6,2),
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source       TEXT        DEFAULT 'GPS'
  );
CREATE TABLE IF NOT EXISTS driver_availability (
    driver_id          TEXT        PRIMARY KEY,
    status             TEXT        NOT NULL DEFAULT 'OFFLINE',
    shift_start        TIMESTAMPTZ,
    shift_end          TIMESTAMPTZ,
    current_job_id     UUID,
    last_ping          TIMESTAMPTZ,
    zone_id            TEXT,
    hours_worked_today DECIMAL(5,2) DEFAULT 0
  );
CREATE TABLE IF NOT EXISTS ambulance_capabilities (
    vehicle_id          TEXT        PRIMARY KEY,
    level               TEXT        NOT NULL DEFAULT 'BLS',
    equipment           JSONB       NOT NULL DEFAULT '[]',
    paramedic_id        TEXT,
    paramedic_certified BOOLEAN     NOT NULL DEFAULT FALSE,
    certified_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    operational_status  TEXT        NOT NULL DEFAULT 'READY'
  );
CREATE TABLE IF NOT EXISTS school_bus_routes (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             TEXT        NOT NULL,
    route_name            TEXT        NOT NULL,
    route_code            TEXT,
    direction             TEXT        NOT NULL DEFAULT 'PICKUP',
    session               TEXT        NOT NULL DEFAULT 'MORNING',
    route_type            TEXT        NOT NULL DEFAULT 'STUDENT',
    departure_time        TIME        NOT NULL,
    arrival_time          TIME,
    assigned_vehicle_id   TEXT,
    assigned_driver_id    TEXT,
    assigned_attendant_id TEXT,
    seat_capacity         INT         DEFAULT 40,
    student_count         INT         DEFAULT 0,
    waypoints             JSONB       DEFAULT '[]',
    stop_sequence         JSONB       DEFAULT '[]',
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
    status                TEXT        NOT NULL DEFAULT 'ACTIVE',
    reassignment_history  JSONB       DEFAULT '[]',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS session               TEXT    NOT NULL DEFAULT 'MORNING';
ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS route_type            TEXT    NOT NULL DEFAULT 'STUDENT';
ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS assigned_attendant_id TEXT;
ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS seat_capacity         INT     DEFAULT 40;
ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS stop_sequence         JSONB   DEFAULT '[]';
ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS is_active             BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS reassignment_history  JSONB   DEFAULT '[]';
CREATE TABLE IF NOT EXISTS dispatch_merge_suggestions (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            TEXT        NOT NULL,
    job_a_id             UUID        NOT NULL,
    job_b_id             UUID        NOT NULL,
    merge_score          INT         NOT NULL,
    pickup_road_km       DECIMAL(10,3),
    pickup_time_diff_min DECIMAL(10,1),
    dropoff_road_km      DECIMAL(10,3),
    combined_passengers  INT,
    estimated_saving_km  DECIMAL(10,2),
    routing_source       TEXT,
    merge_reasons        JSONB       DEFAULT '[]',
    status               TEXT        NOT NULL DEFAULT 'PENDING',
    triggered_by         TEXT        DEFAULT 'JOB_CREATE',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at           TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    actioned_at          TIMESTAMPTZ,
    merged_job_id        UUID,
    UNIQUE(job_a_id, job_b_id)
  );
CREATE INDEX IF NOT EXISTS idx_dj_tenant  ON dispatch_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dj_status  ON dispatch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_dj_service ON dispatch_jobs(service_type);
CREATE INDEX IF NOT EXISTS idx_dj_created ON dispatch_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_da_job     ON dispatch_attempts(dispatch_job_id);
CREATE INDEX IF NOT EXISTS idx_da_token   ON dispatch_attempts(accept_token);
CREATE INDEX IF NOT EXISTS idx_dw_tenant  ON dispatch_weights(tenant_id, service_type, priority);
CREATE INDEX IF NOT EXISTS idx_dms_tenant ON dispatch_merge_suggestions(tenant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_dms_job_a  ON dispatch_merge_suggestions(job_a_id);
CREATE INDEX IF NOT EXISTS idx_dms_job_b  ON dispatch_merge_suggestions(job_b_id);

-- ── 1. Hours of service (src/lib/fleet/hos-schema.ts) ──
CREATE TABLE IF NOT EXISTS hos_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id     TEXT NOT NULL,
    driver_name   TEXT,
    vehicle_id    TEXT,
    vehicle_code  TEXT,
    duty_status   TEXT NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL,
    ended_at      TIMESTAMPTZ,
    duration_mins INT,
    location      TEXT,
    notes         TEXT,
    source        TEXT NOT NULL DEFAULT 'MANUAL',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS hos_violations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id      TEXT NOT NULL,
    driver_name    TEXT,
    violation_type TEXT NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL,
    severity       TEXT NOT NULL DEFAULT 'WARNING',
    description    TEXT,
    hours_exceeded DECIMAL(5,2),
    status         TEXT NOT NULL DEFAULT 'OPEN',
    acknowledged_at TIMESTAMPTZ,
    resolved_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE INDEX IF NOT EXISTS idx_hos_logs_driver ON hos_logs(driver_id);
CREATE INDEX IF NOT EXISTS idx_hos_logs_started ON hos_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hos_logs_status ON hos_logs(duty_status);
CREATE INDEX IF NOT EXISTS idx_hos_violations_driver ON hos_violations(driver_id);
CREATE INDEX IF NOT EXISTS idx_hos_violations_status ON hos_violations(status);

-- ── 2. Runtime role access ──
GRANT USAGE ON SCHEMA ai TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_evaluation_metrics TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_roi_metrics TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_matrix_cache TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_risk_scores TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai.agent_anomaly_flags TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bus_ops_plan_recommendations TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_optimisation_results TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incident_triage_assessments TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_optimiser_recommendations TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_coaching_plans TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demand_forecasts TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_ai_policies TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_approvals TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preventive_maintenance_forecasts TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_types TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_work_orders TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_lifecycle_events TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_allocations TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_transfers TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_vehicle_insurance TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_jobs TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_attempts TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_weights TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_locations TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_availability TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ambulance_capabilities TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_bus_routes TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_merge_suggestions TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hos_logs TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hos_violations TO fleet360_app;

-- ── 3. Isolation for tables that already had tenant_id ──
ALTER TABLE IF EXISTS public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agent_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.agent_runs;
CREATE POLICY tenant_isolation ON public.agent_runs FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.agent_evaluation_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agent_evaluation_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.agent_evaluation_metrics;
CREATE POLICY tenant_isolation ON public.agent_evaluation_metrics FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.agent_roi_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agent_roi_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.agent_roi_metrics;
CREATE POLICY tenant_isolation ON public.agent_roi_metrics FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.bus_ops_plan_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_ops_plan_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.bus_ops_plan_recommendations;
CREATE POLICY tenant_isolation ON public.bus_ops_plan_recommendations FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.demand_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.demand_forecasts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.demand_forecasts;
CREATE POLICY tenant_isolation ON public.demand_forecasts FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.tenant_ai_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tenant_ai_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_ai_policies;
CREATE POLICY tenant_isolation ON public.tenant_ai_policies FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agent_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.agent_approvals;
CREATE POLICY tenant_isolation ON public.agent_approvals FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.whatsapp_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.whatsapp_messages;
CREATE POLICY tenant_isolation ON public.whatsapp_messages FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.preventive_maintenance_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.preventive_maintenance_forecasts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.preventive_maintenance_forecasts;
CREATE POLICY tenant_isolation ON public.preventive_maintenance_forecasts FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.dispatch_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dispatch_weights FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.dispatch_weights;
CREATE POLICY tenant_isolation ON public.dispatch_weights FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
ALTER TABLE IF EXISTS public.dispatch_merge_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dispatch_merge_suggestions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.dispatch_merge_suggestions;
CREATE POLICY tenant_isolation ON public.dispatch_merge_suggestions FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- ── 4. tenant_id and isolation for the tables that had none ──

-- fleet_risk_scores
ALTER TABLE IF EXISTS public.fleet_risk_scores ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.fleet_risk_scores ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.fleet_risk_scores AS x SET tenant_id = p.tenant_id::text FROM public.vehicles AS p WHERE x.tenant_id IS NULL AND x.vehicle_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_fleet_risk_scores_tenant_id ON public.fleet_risk_scores (tenant_id);
ALTER TABLE IF EXISTS public.fleet_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fleet_risk_scores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.fleet_risk_scores;
CREATE POLICY tenant_isolation ON public.fleet_risk_scores FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- fleet_work_orders
ALTER TABLE IF EXISTS public.fleet_work_orders ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.fleet_work_orders ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.fleet_work_orders AS x SET tenant_id = p.tenant_id::text FROM public.vehicles AS p WHERE x.tenant_id IS NULL AND x.vehicle_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_fleet_work_orders_tenant_id ON public.fleet_work_orders (tenant_id);
ALTER TABLE IF EXISTS public.fleet_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fleet_work_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.fleet_work_orders;
CREATE POLICY tenant_isolation ON public.fleet_work_orders FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- fleet_lifecycle_events
ALTER TABLE IF EXISTS public.fleet_lifecycle_events ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.fleet_lifecycle_events ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.fleet_lifecycle_events AS x SET tenant_id = p.tenant_id::text FROM public.vehicles AS p WHERE x.tenant_id IS NULL AND x.vehicle_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_fleet_lifecycle_events_tenant_id ON public.fleet_lifecycle_events (tenant_id);
ALTER TABLE IF EXISTS public.fleet_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fleet_lifecycle_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.fleet_lifecycle_events;
CREATE POLICY tenant_isolation ON public.fleet_lifecycle_events FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- fleet_allocations
ALTER TABLE IF EXISTS public.fleet_allocations ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.fleet_allocations ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.fleet_allocations AS x SET tenant_id = p.tenant_id::text FROM public.vehicles AS p WHERE x.tenant_id IS NULL AND x.vehicle_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_fleet_allocations_tenant_id ON public.fleet_allocations (tenant_id);
ALTER TABLE IF EXISTS public.fleet_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fleet_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.fleet_allocations;
CREATE POLICY tenant_isolation ON public.fleet_allocations FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- fleet_transfers
ALTER TABLE IF EXISTS public.fleet_transfers ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.fleet_transfers ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.fleet_transfers AS x SET tenant_id = p.tenant_id::text FROM public.vehicles AS p WHERE x.tenant_id IS NULL AND x.vehicle_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_fleet_transfers_tenant_id ON public.fleet_transfers (tenant_id);
ALTER TABLE IF EXISTS public.fleet_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fleet_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.fleet_transfers;
CREATE POLICY tenant_isolation ON public.fleet_transfers FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- fleet_vehicle_insurance
ALTER TABLE IF EXISTS public.fleet_vehicle_insurance ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.fleet_vehicle_insurance ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.fleet_vehicle_insurance AS x SET tenant_id = p.tenant_id::text FROM public.vehicles AS p WHERE x.tenant_id IS NULL AND x.vehicle_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_fleet_vehicle_insurance_tenant_id ON public.fleet_vehicle_insurance (tenant_id);
ALTER TABLE IF EXISTS public.fleet_vehicle_insurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fleet_vehicle_insurance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.fleet_vehicle_insurance;
CREATE POLICY tenant_isolation ON public.fleet_vehicle_insurance FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- ambulance_capabilities
ALTER TABLE IF EXISTS public.ambulance_capabilities ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.ambulance_capabilities ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.ambulance_capabilities AS x SET tenant_id = p.tenant_id::text FROM public.vehicles AS p WHERE x.tenant_id IS NULL AND x.vehicle_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_ambulance_capabilities_tenant_id ON public.ambulance_capabilities (tenant_id);
ALTER TABLE IF EXISTS public.ambulance_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ambulance_capabilities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.ambulance_capabilities;
CREATE POLICY tenant_isolation ON public.ambulance_capabilities FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- hos_logs
ALTER TABLE IF EXISTS public.hos_logs ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.hos_logs ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.hos_logs AS x SET tenant_id = p.tenant_id::text FROM public.drivers AS p WHERE x.tenant_id IS NULL AND x.driver_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_hos_logs_tenant_id ON public.hos_logs (tenant_id);
ALTER TABLE IF EXISTS public.hos_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hos_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.hos_logs;
CREATE POLICY tenant_isolation ON public.hos_logs FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- hos_violations
ALTER TABLE IF EXISTS public.hos_violations ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.hos_violations ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.hos_violations AS x SET tenant_id = p.tenant_id::text FROM public.drivers AS p WHERE x.tenant_id IS NULL AND x.driver_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_hos_violations_tenant_id ON public.hos_violations (tenant_id);
ALTER TABLE IF EXISTS public.hos_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hos_violations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.hos_violations;
CREATE POLICY tenant_isolation ON public.hos_violations FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- driver_coaching_plans
ALTER TABLE IF EXISTS public.driver_coaching_plans ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.driver_coaching_plans ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.driver_coaching_plans AS x SET tenant_id = p.tenant_id::text FROM public.drivers AS p WHERE x.tenant_id IS NULL AND x.driver_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_driver_coaching_plans_tenant_id ON public.driver_coaching_plans (tenant_id);
ALTER TABLE IF EXISTS public.driver_coaching_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.driver_coaching_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.driver_coaching_plans;
CREATE POLICY tenant_isolation ON public.driver_coaching_plans FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- dispatch_attempts
ALTER TABLE IF EXISTS public.dispatch_attempts ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.dispatch_attempts ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.dispatch_attempts AS x SET tenant_id = p.tenant_id::text FROM public.dispatch_jobs AS p WHERE x.tenant_id IS NULL AND x.dispatch_job_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_dispatch_attempts_tenant_id ON public.dispatch_attempts (tenant_id);
ALTER TABLE IF EXISTS public.dispatch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dispatch_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.dispatch_attempts;
CREATE POLICY tenant_isolation ON public.dispatch_attempts FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- dispatch_optimiser_recommendations
ALTER TABLE IF EXISTS public.dispatch_optimiser_recommendations ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.dispatch_optimiser_recommendations ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.dispatch_optimiser_recommendations AS x SET tenant_id = p.tenant_id::text FROM public.dispatch_jobs AS p WHERE x.tenant_id IS NULL AND x.job_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_dispatch_optimiser_recommendations_tenant_id ON public.dispatch_optimiser_recommendations (tenant_id);
ALTER TABLE IF EXISTS public.dispatch_optimiser_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dispatch_optimiser_recommendations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.dispatch_optimiser_recommendations;
CREATE POLICY tenant_isolation ON public.dispatch_optimiser_recommendations FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- incident_triage_assessments
ALTER TABLE IF EXISTS public.incident_triage_assessments ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.incident_triage_assessments ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
UPDATE public.incident_triage_assessments AS x SET tenant_id = p.tenant_id::text FROM operations.incidents AS p WHERE x.tenant_id IS NULL AND x.incident_id::text = p.id::text;
CREATE INDEX IF NOT EXISTS idx_incident_triage_assessments_tenant_id ON public.incident_triage_assessments (tenant_id);
ALTER TABLE IF EXISTS public.incident_triage_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.incident_triage_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.incident_triage_assessments;
CREATE POLICY tenant_isolation ON public.incident_triage_assessments FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- ai.agent_anomaly_flags
ALTER TABLE IF EXISTS ai.agent_anomaly_flags ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS ai.agent_anomaly_flags ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
CREATE INDEX IF NOT EXISTS idx_agent_anomaly_flags_tenant_id ON ai.agent_anomaly_flags (tenant_id);
ALTER TABLE IF EXISTS ai.agent_anomaly_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ai.agent_anomaly_flags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai.agent_anomaly_flags;
CREATE POLICY tenant_isolation ON ai.agent_anomaly_flags FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

-- vehicle_types
ALTER TABLE IF EXISTS public.vehicle_types ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE IF EXISTS public.vehicle_types ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
CREATE INDEX IF NOT EXISTS idx_vehicle_types_tenant_id ON public.vehicle_types (tenant_id);
ALTER TABLE IF EXISTS public.vehicle_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.vehicle_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.vehicle_types;
CREATE POLICY tenant_isolation ON public.vehicle_types FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS shared_catalog_read ON public.vehicle_types;
CREATE POLICY shared_catalog_read ON public.vehicle_types FOR SELECT USING (tenant_id IS NULL);
