/**
 * GET  /api/leasing/contracts/[id]/drivers — full allocation history for a contract
 * POST /api/leasing/contracts/[id]/drivers — allocate a driver
 *   Body: { driverId, contractVehicleId?, notes? }
 *   - Releases any currently ACTIVE allocation on the same (contract, vehicle)
 *     before creating the new one (transactional).
 *
 * Tenant scoping: requires x-tenant-id. The contract is verified to belong
 * to that tenant before any reads or writes. The new LeaseDriverAllocation
 * row is stamped with the caller's tenant id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    // Confirm the contract belongs to the caller's tenant before exposing
      // allocation history (otherwise we'd leak other tenants' driver mappings).
      const contract = await tx.leaseContract2.findFirst({
        where: { id: params.id, tenantId },
        select: { id: true },
      });
      if (!contract) {
        return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
      }

      const allocations = await tx.leaseDriverAllocation.findMany({
        where: { tenantId, contractId: params.id },
        orderBy: [{ status: 'asc' }, { allocatedAt: 'desc' }],
      });

      const driverIds = [...new Set(allocations.map(a => a.driverId))];
      const drivers = await tx.driver.findMany({
        where: { id: { in: driverIds } },
        select: {
          id: true, name: true, firstName: true, lastName: true,
          contactNumber: true, licenseNumber: true, licenseExpiry: true,
        },
      });
      const byId = new Map(drivers.map(d => [d.id, d]));

      return NextResponse.json(
        allocations.map(a => ({ ...a, driver: byId.get(a.driverId) ?? null })),
      );
  });
}


export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const driverId = String(body.driverId ?? '').trim();
    if (!driverId) {
      return NextResponse.json({ error: 'driverId is required' }, { status: 400 });
    }

    const contract = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, deletedAt: true, status: true },
    });
    if (!driver || driver.deletedAt) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }
    if (driver.status === 'SUSPENDED' || driver.status === 'INACTIVE') {
      return NextResponse.json({ error: `Driver is ${driver.status}` }, { status: 409 });
    }

    const contractVehicleId = body.contractVehicleId ?? null;

    // Atomically release any current allocation on this (contract, vehicle) and create new.
    const newAllocation = await prisma.$transaction(async (tx) => {
      await tx.leaseDriverAllocation.updateMany({
        where: { contractId: params.id, contractVehicleId, status: 'ACTIVE' },
        data: {
          status: 'RELEASED',
          releasedAt: new Date(),
          releaseReason: 'Replaced by new allocation',
          releasedBy: req.headers.get('x-user-id') ?? null,
        },
      });
      return tx.leaseDriverAllocation.create({
        data: {
          driverId,
          contractId: params.id,
          contractVehicleId,
          allocatedBy: req.headers.get('x-user-id') ?? null,
          notes: body.notes ?? null,
          status: 'ACTIVE',
          tenantId,
        },
      });
    });

    // Sync the convenience driverId column on the LeaseContractVehicle for the
    // existing dashboard widgets that read it directly. LeaseContractVehicle
    // is scoped via the parent contract (already verified above) so no
    // extra tenant filter is needed.
    if (contractVehicleId) {
      await withTenantRls(prisma, tenantId, async (tx) =>
        tx.leaseContractVehicle.update({
        where: { id: contractVehicleId },
        data: { driverId },
      }),
      );
    }

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? 'system',
      userRole: req.headers.get('x-user-role') ?? 'STAFF',
      entityType: 'LeaseDriverAllocation',
      entityId: newAllocation.id,
      action: 'CREATE',
      details: `Driver ${driverId} allocated to contract ${params.id}${contractVehicleId ? ` / vehicle ${contractVehicleId}` : ''}.`,
    });

    return NextResponse.json(newAllocation, { status: 201 });
    } catch (err) {
    captureException(err, { context: 'leasing.contracts.drivers.allocate', tags: { contractId: params.id } });
    return NextResponse.json({ error: 'Allocation failed' }, { status: 500 });
  }
}
