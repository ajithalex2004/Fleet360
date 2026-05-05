import { prisma } from '@/lib/prisma';

const _g = globalThis as { _fleetSchemaInit?: Promise<void> };

// Singleton: runs once per server process, concurrent callers wait on same Promise
export function ensureFleetSchema(): Promise<void> {
  if (_g._fleetSchemaInit) return _g._fleetSchemaInit;
  _g._fleetSchemaInit = _doInit()
    .then(async () => {
      // Verify the primary table was actually created (Neon cold-start can silently
      // swallow CREATE TABLE errors via exec(), leaving the singleton resolved but
      // tables absent). Reset the singleton so the next request retries.
      const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS(
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'vehicle_types'
         ) AS exists`,
      ).catch(() => [] as { exists: boolean }[]);
      if (!rows[0]?.exists) {
        throw new Error('Fleet schema init incomplete: vehicle_types not created (Neon cold-start?)');
      }
    })
    .catch((e) => { delete _g._fleetSchemaInit; throw e; });
  return _g._fleetSchemaInit;
}

async function _doInit(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $DDL$
    BEGIN
      -- ── vehicle_types ─────────────────────────────────────────────────────────
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

      -- ── fleet_work_orders ──────────────────────────────────────────────────────
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

      -- ── fleet_lifecycle_events ─────────────────────────────────────────────────
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

      -- ── fleet_allocations ──────────────────────────────────────────────────────
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

      -- ── fleet_transfers ────────────────────────────────────────────────────────
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

      -- ── fleet_vehicle_insurance ────────────────────────────────────────────────
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

      -- ── Indexes: vehicle_types ────────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_vt_code       ON vehicle_types(code);
      CREATE INDEX IF NOT EXISTS idx_vt_group      ON vehicle_types(vehicle_group);
      CREATE INDEX IF NOT EXISTS idx_vt_active     ON vehicle_types(is_active);

      -- ── Indexes: fleet_work_orders ─────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_fwo_vehicle    ON fleet_work_orders(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_fwo_status     ON fleet_work_orders(status);
      CREATE INDEX IF NOT EXISTS idx_fwo_priority   ON fleet_work_orders(priority);
      CREATE INDEX IF NOT EXISTS idx_fwo_scheduled  ON fleet_work_orders(scheduled_date);
      CREATE INDEX IF NOT EXISTS idx_fwo_created    ON fleet_work_orders(created_at DESC);

      -- ── Indexes: fleet_lifecycle_events ───────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_fle_vehicle    ON fleet_lifecycle_events(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_fle_event_type ON fleet_lifecycle_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_fle_event_date ON fleet_lifecycle_events(event_date DESC);

      -- ── Indexes: fleet_allocations ─────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_fa_vehicle     ON fleet_allocations(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_fa_status      ON fleet_allocations(status);
      CREATE INDEX IF NOT EXISTS idx_fa_alloc_date  ON fleet_allocations(allocation_date DESC);

      -- ── Indexes: fleet_transfers ───────────────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_ft_vehicle     ON fleet_transfers(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_ft_status      ON fleet_transfers(status);
      CREATE INDEX IF NOT EXISTS idx_ft_date        ON fleet_transfers(transfer_date DESC);

      -- ── Indexes: fleet_vehicle_insurance ──────────────────────────────────────
      CREATE INDEX IF NOT EXISTS idx_fvi_vehicle    ON fleet_vehicle_insurance(vehicle_id);
      CREATE INDEX IF NOT EXISTS idx_fvi_status     ON fleet_vehicle_insurance(status);
      CREATE INDEX IF NOT EXISTS idx_fvi_end_date   ON fleet_vehicle_insurance(end_date);
    END
    $DDL$
  `);
}
