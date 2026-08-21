/**
 * GET  /api/bus-ops/fleet-optimizer/runs/:id
 *
 * Returns the run row + structured routes/stops/unassigned. The client
 * polls this every 2s while status is PENDING / VALIDATING / SOLVING.
 * When status transitions to a terminal state (SUCCESS / INFEASIBLE /
 * FAILED / CANCELLED / PUBLISHED) the poll stops.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type IdCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const run = await prisma.fleetOptimizationRun.findFirst({
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
}
