/**
 * Per-tenant payment reminder schedules.
 *
 * finance_reminder_schedules holds each tenant's own schedules, under row
 * level security (migration 20261005090000_finance_tenant_tables). The five
 * platform defaults live in finance.finance_reminder_schedule_template; a
 * tenant created after that migration gets its copy on first use, the way
 * the chart of accounts works (chart-of-accounts.ts).
 */
import type { TxClient } from '@/lib/rls';

/**
 * Copies the default schedules to the tenant when it has none. Runs inside
 * the caller's tenant transaction; concurrent first requests are harmless
 * (ON CONFLICT on the per-tenant name key).
 *
 * Checks first, with a read that cannot fail, that the migration has run: a
 * failing statement would abort the caller's transaction.
 */
export async function ensureTenantReminderSchedules(tx: TxClient, tenantId: string): Promise<void> {
  const [state] = await tx.$queryRawUnsafe<Array<{ ready: boolean }>>(
    `SELECT to_regclass('finance.finance_reminder_schedule_template') IS NOT NULL AS ready`,
  );
  if (!state?.ready) return;

  await tx.$executeRawUnsafe(
    `INSERT INTO finance_reminder_schedules
       (tenant_id, name, trigger_type, trigger_days, channel, template_subject, template_body,
        is_active, module_filter, branch_filter)
     SELECT $1, t.name, t.trigger_type, t.trigger_days, t.channel, t.template_subject, t.template_body,
            t.is_active, t.module_filter, t.branch_filter
       FROM finance.finance_reminder_schedule_template t
      WHERE NOT EXISTS (SELECT 1 FROM finance_reminder_schedules s WHERE s.tenant_id = $1)
     ON CONFLICT (tenant_id, name) DO NOTHING`,
    tenantId,
  );
}
