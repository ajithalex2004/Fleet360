/**
 * Agent Infrastructure Schema
 * ----------------------------
 * Three tables that back the entire agent system:
 *   agent_runs           — immutable audit log of every agent execution
 *   fleet_risk_scores    — latest risk score per vehicle (upserted on each run)
 *   finance_anomaly_flags — flagged financial records awaiting review
 */
import { prisma } from '@/lib/prisma';

const _g = globalThis as { _agentsSchemaInit?: Promise<void> };

export function ensureAgentSchema(): Promise<void> {
  if (_g._agentsSchemaInit) return _g._agentsSchemaInit;
  _g._agentsSchemaInit = _doInit().catch((e) => {
    delete _g._agentsSchemaInit;
    throw e;
  });
  return _g._agentsSchemaInit;
}

async function _doInit(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $DDL$
    BEGIN
      -- ── agent_runs ─────────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS agent_runs (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id          TEXT NOT NULL,
        tenant_id         TEXT NOT NULL DEFAULT 'default',
        event_type        TEXT NOT NULL,
        entity_id         TEXT,
        input             JSONB,
        output            JSONB,
        risk_score        NUMERIC(5,3),
        action_taken      TEXT,
        items_processed   INT DEFAULT 0,
        actions_created   INT DEFAULT 0,
        duration_ms       INT,
        status            TEXT NOT NULL DEFAULT 'COMPLETED',
        error_text        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id   ON agent_runs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_id  ON agent_runs(tenant_id);

      -- ── fleet_risk_scores ──────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS fleet_risk_scores (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id               UUID NOT NULL,
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

      -- ── finance_anomaly_flags ──────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS finance_anomaly_flags (
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

      CREATE INDEX IF NOT EXISTS idx_anomaly_flags_severity    ON finance_anomaly_flags(severity);
      CREATE INDEX IF NOT EXISTS idx_anomaly_flags_status      ON finance_anomaly_flags(status);
      CREATE INDEX IF NOT EXISTS idx_anomaly_flags_entity_type ON finance_anomaly_flags(entity_type);
      CREATE INDEX IF NOT EXISTS idx_anomaly_flags_created_at  ON finance_anomaly_flags(created_at DESC);
      -- Prevent duplicate flags for same entity + detector combo while OPEN
      CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_flags_open_dedup
        ON finance_anomaly_flags(entity_id, detector_id)
        WHERE status = 'OPEN';

      -- ── route_optimisation_results ─────────────────────────────────────────────
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

      -- ── incident_triage_assessments ────────────────────────────────────────────
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

      -- ── dispatch_optimiser_recommendations ─────────────────────────────────────
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

      -- ── driver_coaching_plans ──────────────────────────────────────────────────
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

      -- ── demand_forecasts ───────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS demand_forecasts (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
        CONSTRAINT demand_forecasts_period_segment_key UNIQUE (forecast_period, segment, vehicle_type, branch_id)
      );

      CREATE INDEX IF NOT EXISTS idx_demand_period   ON demand_forecasts(forecast_period);
      CREATE INDEX IF NOT EXISTS idx_demand_segment  ON demand_forecasts(segment);
      CREATE INDEX IF NOT EXISTS idx_demand_created  ON demand_forecasts(created_at DESC);
    END
    $DDL$
  `);
}
