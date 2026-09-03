/**
 * Job: fleet-documents-sweep
 *
 * Direct in-process handler — NOT routed through forwardToRoute(). That
 * adapter does an internal fetch() to the route's own URL, which is a
 * fresh incoming request and goes through middleware exactly like an
 * external call would; the underlying route path isn't in PUBLIC_PREFIXES,
 * carries no xl-session cookie, and would 401 before the route's own
 * CRON_SECRET check ever ran. Calling the sweep engine directly here
 * (same shape as dunning-sweep.ts) avoids that entirely.
 *
 * Iterates every active tenant via runSweep when triggered by CRON_SECRET
 * (no x-tenant-id), or just the caller's own tenant for an on-demand,
 * session-authenticated run.
 */
import type { JobContext, JobResult } from '@/lib/jobs/registry';
import { runSweep } from '@/lib/prisma-sweep';
import { executeFleetExpirySweep } from '@/lib/fleet/expiry-grounding-engine';
import { notifyGroundingChanges } from '@/lib/fleet/expiry-grounding-notify';
import { captureException } from '@/lib/sentry';

export async function runFleetDocumentsSweep(ctx: JobContext): Promise<JobResult> {
  const dryRun = ctx.searchParams.get('dryRun') === '1';
  const gracePeriodParam = ctx.searchParams.get('mulkiyaGracePeriodDays');
  const mulkiyaGracePeriodDays = gracePeriodParam ? parseInt(gracePeriodParam, 10) : 30;
  const tenantHeader = ctx.tenantId ?? undefined;

  const perTenant = await runSweep(
    ({ tx, tenantId }) => executeFleetExpirySweep(tx, tenantId, { mulkiyaGracePeriodDays, dryRun }),
    { tenantHeader },
  );

  if (!dryRun) {
    await Promise.all(
      perTenant.map(({ tenantId, result }) =>
        notifyGroundingChanges(tenantId, result.vehicleRecords).catch((err) =>
          captureException(err, { context: 'jobs.fleet-documents-sweep.notify', tags: { tenantId } }),
        ),
      ),
    );
  }

  const totals = perTenant.reduce(
    (acc, r) => {
      acc.scanned += r.result.totalVehiclesEvaluated;
      acc.grounded += r.result.newlyGroundedCount;
      acc.restored += r.result.newlyRestoredCount;
      return acc;
    },
    { scanned: 0, grounded: 0, restored: 0 },
  );

  return {
    status: 'ok',
    summary: `Scanned ${totals.scanned} vehicles across ${perTenant.length} tenant(s); ${totals.grounded} grounded, ${totals.restored} restored`,
    data: { dryRun, tenantsScanned: perTenant.length, ...totals },
  };
}
