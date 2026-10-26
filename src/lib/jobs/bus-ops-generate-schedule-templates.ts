/**
 * Job: bus-ops-generate-schedule-templates
 *
 * Nightly-scheduled TripSchedule generation for every ACTIVE
 * BusOpsScheduleTemplate across every tenant. Rolling window: today
 * (UTC midnight) → today + 7 days by default (override via ?days=N).
 *
 * Idempotent — the underlying generator (src/lib/bus-ops/
 * generate-schedule-template.ts) skips any date that already has a
 * trip for the same template.
 */

import { prisma } from '@/lib/prisma';
import { runSweep } from '@/lib/prisma-sweep';
import { withTenantRls } from '@/lib/rls';
import {
  generateScheduleTemplate,
  type GenerateStats,
} from '@/lib/bus-ops/generate-schedule-template';
import type { JobContext, JobResult } from './registry';

const DEFAULT_HORIZON_DAYS = 7;

export async function runBusOpsGenerateScheduleTemplates(ctx: JobContext): Promise<JobResult> {
  const horizonRaw = Number(ctx.searchParams.get('days') ?? DEFAULT_HORIZON_DAYS);
  const horizonDays = Math.max(1, Math.min(30, Number.isFinite(horizonRaw) ? horizonRaw : DEFAULT_HORIZON_DAYS));

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + horizonDays));

  // Templates are read per tenant, in each tenant's RLS scope (runSweep), and
  // each is generated inside a transaction in its tenant (the generator's
  // global-client queries join it, src/lib/prisma.ts). This ran on the bare
  // client: a scheduled run has no request tenant, so RLS hid every template
  // and no trip was ever generated; a manual run only covered the caller's
  // tenant. A manual run still covers just its own tenant (tenantHeader).
  const perTenant = await runSweep(async ({ tx }) => tx.busOpsScheduleTemplate.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: { id: true, tenantId: true, name: true },
  }), { tenantHeader: ctx.tenantId ?? undefined });
  const templates = perTenant.flatMap((r) => r.result);

  const aggregate: GenerateStats = {
    generated: 0, skippedAlreadyExisted: 0, skippedOutOfWindow: 0,
    skippedInactiveOrException: 0, errors: 0,
  };
  const perTemplate: Array<{ templateId: string; tenantId: string; name: string } & GenerateStats> = [];

  for (const tpl of templates) {
    try {
      // One transaction per template: its trips are written together, and
      // the generator skips dates that already have a trip, so a retry is safe.
      const stats = await withTenantRls(prisma, tpl.tenantId, () => generateScheduleTemplate({
        templateId: tpl.id, tenantId: tpl.tenantId, from, to,
      }), { timeoutMs: 120_000 });
      perTemplate.push({ templateId: tpl.id, tenantId: tpl.tenantId, name: tpl.name, ...stats });
      aggregate.generated                  += stats.generated;
      aggregate.skippedAlreadyExisted      += stats.skippedAlreadyExisted;
      aggregate.skippedOutOfWindow         += stats.skippedOutOfWindow;
      aggregate.skippedInactiveOrException += stats.skippedInactiveOrException;
      aggregate.errors                     += stats.errors;
    } catch (err) {
      console.error('[bus-ops-generate-schedule-templates] template failed', {
        templateId: tpl.id, tenantId: tpl.tenantId,
        err: err instanceof Error ? err.message : err,
      });
      aggregate.errors++;
    }
  }

  return {
    status: aggregate.errors > 0 && aggregate.generated === 0 ? 'error' : 'ok',
    summary: `Generated ${aggregate.generated} trip(s) across ${templates.length} template(s) for ${horizonDays}-day window; skipped ${aggregate.skippedAlreadyExisted} already-existed, ${aggregate.skippedOutOfWindow} out-of-window, ${aggregate.skippedInactiveOrException} inactive/exception; ${aggregate.errors} error(s)`,
    data: {
      horizonDays,
      windowFrom: from.toISOString().slice(0, 10),
      windowTo:   to.toISOString().slice(0, 10),
      templateCount: templates.length,
      aggregate,
      perTemplate,
    },
  };
}
