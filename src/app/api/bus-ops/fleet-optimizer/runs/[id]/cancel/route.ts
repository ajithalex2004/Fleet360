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
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const CANCELLABLE_STATES = new Set(['PENDING', 'VALIDATING', 'SOLVING']);

type IdCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: IdCtx) {
  const { id } = await params;
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const existing = await prisma.fleetOptimizationRun.findFirst({
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

  await prisma.fleetOptimizationRun.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      statusReason: 'Cancelled by operator',
    },
  });
  return NextResponse.json({ id, status: 'CANCELLED' });
}
