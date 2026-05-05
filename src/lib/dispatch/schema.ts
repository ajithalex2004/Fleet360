/**
 * TRIPEXL Auto-Dispatch — Database Schema Bootstrap
 * All CREATE TABLE IF NOT EXISTS are idempotent — safe to call on every request.
 */

import { prisma } from '@/lib/prisma';
import type { DispatchWeights, ServiceType, DispatchPriority } from './types';

/* ─────────────────────────────────────────────────────────────
   Default weights — overridden per-tenant via dispatch_weights
───────────────────────────────────────────────────────────── */
export const DEFAULT_WEIGHTS: Record<string, Record<string, DispatchWeights>> = {
  PASSENGER: {
    NORMAL:    { distance: 0.30, eta: 0.25, rating: 0.20, cost: 0.15, load: 0.10 },
    URGENT:    { distance: 0.20, eta: 0.45, rating: 0.15, cost: 0.10, load: 0.10 },
    EMERGENCY: { distance: 0.10, eta: 0.60, rating: 0.15, cost: 0.05, load: 0.10 },
    SCHEDULED: { distance: 0.30, eta: 0.15, rating: 0.25, cost: 0.20, load: 0.10 },
  },
  FREIGHT: {
    NORMAL:    { distance: 0.15, eta: 0.15, rating: 0.10, cost: 0.25, load: 0.35 },
    URGENT:    { distance: 0.15, eta: 0.30, rating: 0.10, cost: 0.15, load: 0.30 },
    SCHEDULED: { distance: 0.20, eta: 0.10, rating: 0.10, cost: 0.30, load: 0.30 },
  },
  DELIVERY: {
    NORMAL:    { distance: 0.25, eta: 0.20, rating: 0.15, cost: 0.25, load: 0.15 },
    URGENT:    { distance: 0.15, eta: 0.40, rating: 0.15, cost: 0.15, load: 0.15 },
  },
  AMBULANCE: {
    // P1: cardiac arrest / life-threatening — ETA dominates
    P1:        { distance: 0.00, eta: 0.70, rating: 0.00, cost: 0.00, equipment: 0.10, crewReadiness: 0.10, reliability: 0.10 },
    // P2: trauma / urgent — ETA still dominant but equipment matters
    P2:        { distance: 0.05, eta: 0.60, rating: 0.00, cost: 0.00, equipment: 0.15, crewReadiness: 0.10, reliability: 0.10 },
    // P3: scheduled transfer — balanced scoring
    P3:        { distance: 0.15, eta: 0.40, rating: 0.05, cost: 0.00, equipment: 0.15, crewReadiness: 0.15, reliability: 0.10 },
  },
  TECHNICIAN: {
    NORMAL:    { distance: 0.20, eta: 0.20, rating: 0.15, cost: 0.10, skill: 0.35 },
    URGENT:    { distance: 0.15, eta: 0.30, rating: 0.15, cost: 0.05, skill: 0.35 },
  },
};

/* ─────────────────────────────────────────────────────────────
   Schema bootstrap — singleton Promise stored on globalThis so
   it survives Next.js HMR hot-reloads in development.
   All 23 DDL statements are collapsed into ONE PL/pgSQL block —
   a single round-trip to Neon instead of 23 sequential awaits.
───────────────────────────────────────────────────────────── */
const _g = globalThis as { _dispatchSchemaInit?: Promise<void> };

export function ensureDispatchSchema(): Promise<void> {
  if (_g._dispatchSchemaInit) return _g._dispatchSchemaInit;
  _g._dispatchSchemaInit = _doInit().catch((e) => {
    delete _g._dispatchSchemaInit; // allow retry on failure
    throw e;
  });
  return _g._dispatchSchemaInit;
}

async function _doInit(): Promise<void> {
  // Single PL/pgSQL DO block = ONE network round-trip to Neon
  // instead of 23 sequential $executeRawUnsafe calls (~500ms each on cold connection).
  await prisma.$executeRawUnsafe(`
    DO $DDL$
    BEGIN

      -- dispatch_jobs
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

      -- dispatch_attempts
      CREATE TABLE IF NOT EXISTS dispatch_attempts (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        dispatch_job_id   UUID        REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
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

      -- dispatch_weights
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

      -- vehicle_locations
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

      -- driver_availability
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

      -- ambulance_capabilities
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

      -- school_bus_routes
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

      -- school_bus_routes column migrations
      ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS session               TEXT    NOT NULL DEFAULT 'MORNING';
      ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS route_type            TEXT    NOT NULL DEFAULT 'STUDENT';
      ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS assigned_attendant_id TEXT;
      ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS seat_capacity         INT     DEFAULT 40;
      ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS stop_sequence         JSONB   DEFAULT '[]';
      ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS is_active             BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE school_bus_routes ADD COLUMN IF NOT EXISTS reassignment_history  JSONB   DEFAULT '[]';

      -- dispatch_merge_suggestions
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

      -- indexes (IF NOT EXISTS is supported inside DO blocks in PG 9.5+)
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

    END
    $DDL$
  `);
}

/* ─────────────────────────────────────────────────────────────
   Helper: load effective config for a (tenant, service, priority)
───────────────────────────────────────────────────────────── */
export async function loadDispatchConfig(
  tenantId: string,
  serviceType: ServiceType,
  priority: DispatchPriority,
) {
  await ensureDispatchSchema();

  type Row = Record<string, unknown>;
  const [row] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT * FROM dispatch_weights
    WHERE (tenant_id = $1 OR tenant_id IS NULL)
      AND service_type = $2
      AND priority     = $3
    ORDER BY tenant_id NULLS LAST
    LIMIT 1
  `, tenantId, serviceType, priority).catch(() => [] as Row[]);

  const fallbackPriority = priority.startsWith('P') ? 'P3' : 'NORMAL';
  const defaultW: DispatchWeights =
    DEFAULT_WEIGHTS[serviceType]?.[priority] ??
    DEFAULT_WEIGHTS[serviceType]?.[fallbackPriority] ??
    { distance: 0.30, eta: 0.25, rating: 0.20, cost: 0.15, load: 0.10 };

  let weights = defaultW;
  if (row?.weights) {
    try {
      const parsed = typeof row.weights === 'string' ? JSON.parse(row.weights) : row.weights;
      weights = { ...defaultW, ...parsed };
    } catch {}
  }

  return {
    weights,
    maxAttempts:             row ? Number(row.max_attempts ?? 3) : 3,
    driverResponseTimeoutMin: row ? Number(row.driver_response_timeout_min ?? 6) : 6,
    dispatchRadiusKm:        row ? Number(row.dispatch_radius_km ?? 10) : 10,
    preferSameZone:          row ? row.prefer_same_zone !== false : true,
    crossZoneAllowed:        row ? row.cross_zone_allowed !== false : true,
    allowPreemption:         row ? row.allow_preemption === true : false,
    preemptiblePriorities:   [] as DispatchPriority[],
  };
}
