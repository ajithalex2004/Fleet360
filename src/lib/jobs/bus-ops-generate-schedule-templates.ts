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

  const templates = await prisma.busOpsScheduleTemplate.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: { id: true, tenantId: true, name: true },
  });

  const aggregate: GenerateStats = {
    generated: 0, skippedAlreadyExisted: 0, skippedOutOfWindow: 0,
    skippedInactiveOrException: 0, errors: 0,
  };
  const perTemplate: Array<{ templateId: string; tenantId: string; name: string } & GenerateStats> = [];

  for (const tpl of templates) {
    try {
      const stats = await generateScheduleTemplate({
        templateId: tpl.id, tenantId: tpl.tenantId, from, to,
      });
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
