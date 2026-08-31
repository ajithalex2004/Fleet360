export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/fleet-optimizer/runs/:id/cancel
 *
 * Marks a run CANCELLED. The orchestrator checks this flag between the
 * VALIDATING and SOLVING phases (skips the paid solve) and after SOLVING
 * (persists paid-for results but marks CANCELLED as the final state).
 *
 * Rejected when the run is already in a terminal state (SUCCESS,
 * INFEASIBLE, FAILED, CANCELLED, PUBLISHED). Published runs cannot be
 * cancelled — they've already committed to TripSchedules.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

const CANCELLABLE_STATES = new Set(['PENDING', 'VALIDATING', 'SOLVING']);

type IdCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: IdCtx) {

  const { id } = await params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const existing = await tx.fleetOptimizationRun.findFirst({
        where: { id, tenantId },
        select: { id: true, status: true },
      });
      if (!existing) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

      if (!CANCELLABLE_STATES.has(existing.status)) {
        return NextResponse.json(
          { error: `Cannot cancel a run in status ${existing.status}` },
          { status: 409 },
        );
      }

      await tx.fleetOptimizationRun.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          statusReason: 'Cancelled by operator',
        },
      });
      return NextResponse.json({ id, status: 'CANCELLED' });
  });
}

