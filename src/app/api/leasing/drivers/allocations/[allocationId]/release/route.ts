/**
 * POST /api/leasing/drivers/allocations/[allocationId]/release
 *
 * Release an ACTIVE LeaseDriverAllocation.
 * Body: { reason?: string }
 *
 * - Refuses if the allocation is already RELEASED.
 * - Stamps releasedAt + releasedBy.
 * - Clears the convenience driverId on LeaseContractVehicle if it points
 *   at the released driver.
 * - Audit-logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: { allocationId: string } },
) {
  try {
    const body = await req.json().catch(() => ({}));
    const allocation = await prisma.leaseDriverAllocation.findUnique({
      where: { id: params.allocationId },
    });
    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }
    if (allocation.status === 'RELEASED') {
      return NextResponse.json({ error: 'Allocation is already released' }, { status: 409 });
    }

    const updated = await prisma.leaseDriverAllocation.update({
      where: { id: params.allocationId },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        releasedBy: req.headers.get('x-user-id') ?? null,
        releaseReason: body?.reason ?? 'Manually released',
      },
    });

    if (allocation.contractVehicleId) {
      // Clear the contract-vehicle's convenience driverId only if it still
      // matches this driver — avoids clobbering a parallel re-assignment.
      await prisma.leaseContractVehicle.updateMany({
        where: { id: allocation.contractVehicleId, driverId: allocation.driverId },
        data: { driverId: null },
      });
    }

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'LeaseDriverAllocation',
      entityId: params.allocationId,
      action: 'UPDATE',
      details: `Driver ${allocation.driverId} released from contract ${allocation.contractId}: ${updated.releaseReason}`,
    });

    return NextResponse.json(updated);
  } catch (err) {
    captureException(err, {
      context: 'leasing.drivers.release',
      tags: { allocationId: params.allocationId },
    });
    return NextResponse.json({ error: 'Release failed' }, { status: 500 });
  }
}
