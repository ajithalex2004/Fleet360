export const dynamic = 'force-dynamic';

/**
 * GET  /api/bus-ops/fleet-optimizer/runs/:id
 *
 * Returns the run row + structured routes/stops/unassigned. The client
 * polls this every 2s while status is PENDING / VALIDATING / SOLVING.
 * When status transitions to a terminal state (SUCCESS / INFEASIBLE /
 * FAILED / CANCELLED / PUBLISHED) the poll stops.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

type IdCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: IdCtx) {

  const { id } = await params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const run = await tx.fleetOptimizationRun.findFirst({
        where: { id, tenantId },
        include: {
          routes: {
            orderBy: { sequenceInRun: 'asc' },
            include: { stops: { orderBy: { sequence: 'asc' } } },
          },
          unassigned: true,
        },
      });
      if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
      return NextResponse.json(run);
  });
}

