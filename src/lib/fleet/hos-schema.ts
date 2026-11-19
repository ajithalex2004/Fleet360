import { prisma } from '@/lib/prisma';
import { provisionSchemaOnce, type SchemaSpec } from '@/lib/db/schema-init';

// Runs no DDL where these tables exist; see provisionSchemaOnce.
/** Tables/columns this module needs; checked by the schema readiness report. */
export const HOS_SCHEMA: SchemaSpec = {
  tables: [
    'hos_logs',
    'hos_violations',
  ],
  columns: [
    ['hos_logs', 'tenant_id'],
    ['hos_violations', 'tenant_id'],
  ],
};

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
        tenant_id     TEXT NOT NULL DEFAULT 'default',
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

      ALTER TABLE IF EXISTS hos_logs ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

      -- Violation records
      CREATE TABLE IF NOT EXISTS hos_violations (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      TEXT NOT NULL DEFAULT 'default',
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

      ALTER TABLE IF EXISTS hos_violations ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_hos_logs_tenant ON hos_logs(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_hos_logs_driver ON hos_logs(driver_id);
      CREATE INDEX IF NOT EXISTS idx_hos_logs_started ON hos_logs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_hos_logs_status ON hos_logs(duty_status);
      CREATE INDEX IF NOT EXISTS idx_hos_violations_tenant ON hos_violations(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_hos_violations_driver ON hos_violations(driver_id);
      CREATE INDEX IF NOT EXISTS idx_hos_violations_status ON hos_violations(status);

      -- RLS
      ALTER TABLE IF EXISTS hos_logs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE IF EXISTS hos_logs FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation ON hos_logs;
      CREATE POLICY tenant_isolation ON hos_logs FOR ALL
        USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
        WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

      ALTER TABLE IF EXISTS hos_violations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE IF EXISTS hos_violations FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation ON hos_violations;
      CREATE POLICY tenant_isolation ON hos_violations FOR ALL
        USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
        WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
    END
    $DDL$
  `);
}
