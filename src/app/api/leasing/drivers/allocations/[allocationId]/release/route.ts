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
 *
 * Tenant scoping: requires x-tenant-id. The allocation and any touched
 * contract-vehicle rows must belong to the caller's tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ allocationId: string }> },
) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(bodyRaw);
    const allocation = await prisma.leaseDriverAllocation.findFirst({
      where: { id: params.allocationId, tenantId },
    });
    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }
    if (allocation.status === 'RELEASED') {
      return NextResponse.json({ error: 'Allocation is already released' }, { status: 409 });
    }

    const updated = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseDriverAllocation.update({
      where: { id: params.allocationId },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        releasedBy: req.headers.get('x-user-id') ?? null,
        releaseReason: body?.reason ?? 'Manually released',
      },
    }),
    );

    if (allocation.contractVehicleId) {
      // LeaseContractVehicle is scoped via the parent contract (already
      // owned by this tenant via the allocation), no tenant column on
      // the model itself.
      await withTenantRls(prisma, tenantId, async (tx) =>
        tx.leaseContractVehicle.updateMany({
        where: {
          tenantId,
          id: allocation.contractVehicleId,
          driverId: allocation.driverId,
        },
        data: { driverId: null },
      }),
      );
    }

    void logAudit({
      tenantId,
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
