export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/leasing/returns/sweep-orphaned-handovers
 *
 * Backstop for the synchronous return-workflow trigger (handover COMPLETE
 * → linkReturnFromHandover → attemptProcessReturn). The synchronous path
 * only searches for handovers with no return row at all, which a
 * partially-failed attempt wouldn't produce — this sweep resumes BOTH:
 *   (a) COMPLETED RETURN handovers with no linked return row yet
 *       (Phase 1 never ran — e.g. contract_id was backfilled after the
 *       fact, or a transient failure occurred before the insert), and
 *   (b) return rows whose processingStatus is PENDING or FAILED
 *       (Phase 1 succeeded, Phase 2 — billing/clearance — didn't).
 *
 * Idempotent by construction: linkReturnFromHandover and processReturn are
 * both safe to re-run (partial unique index on handover_id, per-substep
 * completion markers), so running this on a schedule is safe.
 *
 * Auth: optional CRON_SECRET Bearer for external cron, same pattern as
 * mileage-readings/sweep-stale.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { runSweep } from '@/lib/prisma-sweep';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { linkReturnFromHandover, attemptProcessReturn } from '@/lib/leasing/return-workflow';

export async function POST(req: NextRequest) {
  const tenantHeader = req.headers.get('x-tenant-id');
  const cronSecret = process.env.CRON_SECRET;

  if (!tenantHeader) {
    if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  } else {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
  }

  try {
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';

    interface PerTenantResult {
      unlinkedHandoverIds: string[];
      unprocessedReturnIds: string[];
    }

    const perTenant = await runSweep<PerTenantResult>(
      async ({ tx, tenantId }) => {
        const unlinked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT h.id::text AS id FROM leasing_handovers h
             LEFT JOIN lease_vehicle_returns r ON r.handover_id = h.id::text AND r.tenant_id = h.tenant_id
            WHERE h.tenant_id = $1 AND h.handover_type = 'RETURN' AND h.status = 'COMPLETED' AND r.id IS NULL`,
          tenantId,
        );

        const unprocessed = await tx.leaseVehicleReturn.findMany({
          where: { tenantId, processingStatus: { in: ['PENDING', 'FAILED'] } },
          select: { id: true },
        });

        const unlinkedHandoverIds = unlinked.map((r) => r.id);
        let linkedFromUnlinked: string[] = [];
        if (!dryRun) {
          for (const handoverId of unlinkedHandoverIds) {
            try {
              const linked = await linkReturnFromHandover(tx, tenantId, handoverId);
              if (linked) linkedFromUnlinked.push(linked.id);
            } catch (err) {
              captureException(err, { context: 'leasing.returns.sweep.link', extra: { handoverId, tenantId } });
            }
          }
        }

        return {
          unlinkedHandoverIds,
          unprocessedReturnIds: [...linkedFromUnlinked, ...unprocessed.map((r) => r.id)],
        };
      },
      { tenantHeader, advisoryLockKey: 'leasing-returns-sweep-orphaned-handovers' },
    );

    let totalUnlinkedFound = 0;
    let totalReprocessed = 0;
    for (const r of perTenant) {
      totalUnlinkedFound += r.result.unlinkedHandoverIds.length;
      if (dryRun) continue;
      for (const returnId of r.result.unprocessedReturnIds) {
        await attemptProcessReturn(r.tenantId, returnId);
        totalReprocessed += 1;
      }
    }

    if (!dryRun && totalReprocessed > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'LeaseVehicleReturn',
        action: 'UPDATE',
        details: `Orphaned-handover sweep: ${totalUnlinkedFound} unlinked handovers found across ${perTenant.length} tenant(s), ${totalReprocessed} return(s) reprocessed.`,
      });
    }

    return NextResponse.json({
      dryRun,
      tenantsScanned: perTenant.length,
      unlinkedHandoversFound: totalUnlinkedFound,
      returnsReprocessed: totalReprocessed,
    });
  } catch (err) {
    captureException(err, { context: 'leasing.returns.sweep-orphaned-handovers' });
    console.error('[returns sweep-orphaned-handovers] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
