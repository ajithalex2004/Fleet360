import { prisma } from '@/lib/prisma';
import { provisionSchemaOnce, type SchemaSpec } from '@/lib/db/schema-init';

// Runs no DDL where these tables exist; see provisionSchemaOnce.
/** Tables/columns this module needs; checked by the schema readiness report. */
export const HOS_SCHEMA: SchemaSpec = { tables: [
    'hos_logs',
    'hos_violations',
  ] };

export function ensureHosSchema(): Promise<void> {
  return provisionSchemaOnce('hos', HOS_SCHEMA, _doInit);
}

async function _doInit(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $DDL$
    BEGIN
      -- Duty status log
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

      -- Violation records
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

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_hos_logs_driver ON hos_logs(driver_id);
      CREATE INDEX IF NOT EXISTS idx_hos_logs_started ON hos_logs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_hos_logs_status ON hos_logs(duty_status);
      CREATE INDEX IF NOT EXISTS idx_hos_violations_driver ON hos_violations(driver_id);
      CREATE INDEX IF NOT EXISTS idx_hos_violations_status ON hos_violations(status);
    END
    $DDL$
  `);
}
