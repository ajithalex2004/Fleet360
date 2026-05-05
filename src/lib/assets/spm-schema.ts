import { prisma } from '@/lib/prisma';

const _g = globalThis as { _spmSchemaInit?: Promise<void> };

// Singleton: runs once per server process, concurrent callers wait on same Promise
export function ensureSpmSchema(): Promise<void> {
  if (_g._spmSchemaInit) return _g._spmSchemaInit;
  _g._spmSchemaInit = _doInit().catch((e) => {
    delete _g._spmSchemaInit;
    throw e;
  });
  return _g._spmSchemaInit;
}

async function _doInit(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $DDL$
    BEGIN
      -- spm_cycles
      CREATE TABLE IF NOT EXISTS spm_cycles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        cycle_code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        asset_id UUID,
        asset_name TEXT,
        asset_no TEXT,
        asset_category TEXT,
        asset_location TEXT,
        asset_domain TEXT,
        maintenance_type TEXT NOT NULL DEFAULT 'PREVENTIVE',
        interval_days INT NOT NULL DEFAULT 30,
        first_run_at TIMESTAMPTZ,
        last_run_at TIMESTAMPTZ,
        next_run_at TIMESTAMPTZ,
        priority TEXT NOT NULL DEFAULT 'MEDIUM',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        assigned_to TEXT,
        estimated_duration_mins INT DEFAULT 60,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- spm_tickets
      CREATE TABLE IF NOT EXISTS spm_tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        ticket_code TEXT NOT NULL,
        cycle_id UUID NOT NULL,
        cycle_name TEXT,
        asset_id UUID,
        asset_name TEXT,
        asset_no TEXT,
        asset_category TEXT,
        asset_location TEXT,
        asset_domain TEXT,
        maintenance_type TEXT,
        triggered_by TEXT NOT NULL DEFAULT 'SCHEDULER',
        status TEXT NOT NULL DEFAULT 'OPEN',
        priority TEXT NOT NULL DEFAULT 'MEDIUM',
        assigned_to TEXT,
        scheduled_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        findings TEXT,
        resolution_notes TEXT,
        technician_notes TEXT,
        completion_photos TEXT[],
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (cycle_id, (DATE(scheduled_date)))
      );

      -- spm_checklist_templates
      CREATE TABLE IF NOT EXISTS spm_checklist_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        cycle_id UUID NOT NULL,
        item_order INT DEFAULT 0,
        description TEXT NOT NULL,
        is_mandatory BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- spm_ticket_checks
      CREATE TABLE IF NOT EXISTS spm_ticket_checks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        ticket_id UUID NOT NULL,
        template_id UUID,
        item_order INT DEFAULT 0,
        description TEXT NOT NULL,
        is_mandatory BOOLEAN DEFAULT TRUE,
        is_checked BOOLEAN DEFAULT FALSE,
        checked_at TIMESTAMPTZ,
        checked_by TEXT,
        notes TEXT
      );

      -- spm_audit_logs
      CREATE TABLE IF NOT EXISTS spm_audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        run_at TIMESTAMPTZ DEFAULT NOW(),
        triggered_by TEXT NOT NULL DEFAULT 'MANUAL',
        cycles_checked INT DEFAULT 0,
        tickets_generated INT DEFAULT 0,
        cycles_skipped INT DEFAULT 0,
        run_duration_ms INT,
        summary JSONB
      );

      -- Indexes — spm_cycles
      CREATE INDEX IF NOT EXISTS idx_spm_cycles_tenant ON spm_cycles(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_spm_cycles_status ON spm_cycles(status);
      CREATE INDEX IF NOT EXISTS idx_spm_cycles_next_run ON spm_cycles(next_run_at);
      CREATE INDEX IF NOT EXISTS idx_spm_cycles_asset_id ON spm_cycles(asset_id);
      CREATE INDEX IF NOT EXISTS idx_spm_cycles_priority ON spm_cycles(priority);

      -- Indexes — spm_tickets
      CREATE INDEX IF NOT EXISTS idx_spm_tickets_tenant ON spm_tickets(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_spm_tickets_cycle_id ON spm_tickets(cycle_id);
      CREATE INDEX IF NOT EXISTS idx_spm_tickets_status ON spm_tickets(status);
      CREATE INDEX IF NOT EXISTS idx_spm_tickets_scheduled_date ON spm_tickets(scheduled_date);
      CREATE INDEX IF NOT EXISTS idx_spm_tickets_priority ON spm_tickets(priority);
      CREATE INDEX IF NOT EXISTS idx_spm_tickets_asset_id ON spm_tickets(asset_id);

      -- Indexes — spm_checklist_templates
      CREATE INDEX IF NOT EXISTS idx_spm_checklist_templates_cycle ON spm_checklist_templates(cycle_id);
      CREATE INDEX IF NOT EXISTS idx_spm_checklist_templates_tenant ON spm_checklist_templates(tenant_id);

      -- Indexes — spm_ticket_checks
      CREATE INDEX IF NOT EXISTS idx_spm_ticket_checks_ticket ON spm_ticket_checks(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_spm_ticket_checks_tenant ON spm_ticket_checks(tenant_id);

      -- spm_notifications
      CREATE TABLE IF NOT EXISTS spm_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT 'default',
        ticket_id UUID,
        cycle_id UUID,
        user_id TEXT NOT NULL,
        user_name TEXT,
        user_email TEXT,
        type TEXT NOT NULL DEFAULT 'TICKET_ASSIGNED',
        message TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Column migrations — add user-link fields if they don't exist yet
      ALTER TABLE spm_cycles ADD COLUMN IF NOT EXISTS assigned_to_user_id TEXT;
      ALTER TABLE spm_cycles ADD COLUMN IF NOT EXISTS assigned_to_email TEXT;
      ALTER TABLE spm_tickets ADD COLUMN IF NOT EXISTS assigned_to_user_id TEXT;
      ALTER TABLE spm_tickets ADD COLUMN IF NOT EXISTS assigned_to_email TEXT;

      -- Indexes — spm_audit_logs
      CREATE INDEX IF NOT EXISTS idx_spm_audit_logs_tenant ON spm_audit_logs(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_spm_audit_logs_run_at ON spm_audit_logs(run_at);

      -- Indexes — spm_notifications
      CREATE INDEX IF NOT EXISTS idx_spm_notifications_tenant ON spm_notifications(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_spm_notifications_user_id ON spm_notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_spm_notifications_ticket_id ON spm_notifications(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_spm_notifications_is_read ON spm_notifications(is_read);
    END
    $DDL$
  `);
}
