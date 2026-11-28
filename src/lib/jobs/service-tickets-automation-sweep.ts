/**
 * service-tickets-automation-sweep — scheduled job executing FSM Automation rules
 * configured in Admin → Service Configuration → Automation:
 *   - Auto-closure after configurable quiet period on Resolved / Completed tickets
 *   - Periodic reminder notifications on open tickets
 *
 * Supports single-tenant (`ctx.tenantId` set) and all-tenant scheduled runs
 * (`ctx.tenantId === null`), plus `?dryRun=true`.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { runAsTenant } from '@/lib/rls-scope';
import {
  runTicketAutomationSweep,
  type AutomationSweepReport,
} from '@/lib/service-tickets/automation-engine';
import type { JobContext, JobResult } from './registry';

export async function runServiceTicketAutomationSweep(ctx: JobContext): Promise<JobResult> {
  const dryRun = ctx.searchParams.get('dryRun') === 'true';

  if (ctx.tenantId) {
    const report = await withTenantRls(prisma, ctx.tenantId, () =>
      runTicketAutomationSweep(ctx.tenantId!, { dryRun, actorId: ctx.userId }),
    );
    return {
      status: 'ok',
      summary: `${dryRun ? '[Dry run] ' : ''}Evaluated ${report.evaluatedTickets} ticket(s): ${report.autoClosedCount} auto-closed, ${report.remindersSentCount} reminder(s)`,
      data: { ...report },
    };
  }

  // Platform scheduled run: find tenants that have open or recently resolved tickets.
  const distinctTenants = await runAsTenant('*', () =>
    prisma.$queryRawUnsafe<Array<{ tenant_id: string }>>(
      `SELECT DISTINCT tenant_id
         FROM service_tickets
        WHERE deleted_at IS NULL
          AND status NOT IN ('Closed', 'Rejected')`,
    ),
  ).catch(() => [] as Array<{ tenant_id: string }>);

  let totalEvaluated = 0;
  let totalAutoClosed = 0;
  let totalReminders = 0;
  const perTenant: Record<string, AutomationSweepReport | { error: string }> = {};

  for (const row of distinctTenants) {
    if (!row.tenant_id) continue;
    try {
      const report = await withTenantRls(prisma, row.tenant_id, () =>
        runTicketAutomationSweep(row.tenant_id, { dryRun, actorId: ctx.userId }),
      );
      totalEvaluated += report.evaluatedTickets;
      totalAutoClosed += report.autoClosedCount;
      totalReminders += report.remindersSentCount;
      if (report.autoClosedCount > 0 || report.remindersSentCount > 0) {
        perTenant[row.tenant_id] = report;
      }
    } catch (err) {
      perTenant[row.tenant_id] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    status: 'ok',
    summary: `${dryRun ? '[Dry run] ' : ''}Swept ${distinctTenants.length} tenant(s), ${totalEvaluated} ticket(s): ${totalAutoClosed} auto-closed, ${totalReminders} reminder(s)`,
    data: {
      dryRun,
      sweptTenantsCount: distinctTenants.length,
      totalEvaluated,
      totalAutoClosed,
      totalReminders,
      perTenant,
    },
  };
}
