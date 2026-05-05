/**
 * GET  /api/leasing/contracts/[id]/drivers — full allocation history for a contract
 * POST /api/leasing/contracts/[id]/drivers — allocate a driver
 *   Body: { driverId, contractVehicleId?, notes? }
 *   - Releases any currently ACTIVE allocation on the same (contract, vehicle)
 *     before creating the new one (transactional).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const allocations = await prisma.leaseDriverAllocation.findMany({
    where: { contractId: params.id },
    orderBy: [{ status: 'asc' }, { allocatedAt: 'desc' }],
  });

  const driverIds = [...new Set(allocations.map(a => a.driverId))];
  const drivers = await prisma.driver.findMany({
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
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const driverId = String(body.driverId ?? '').trim();
    if (!driverId) {
      return NextResponse.json({ error: 'driverId is required' }, { status: 400 });
    }

    const contract = await prisma.leaseContract2.findUnique({
      where: { id: params.id },
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
        },
      });
    });

    // Sync the convenience driverId column on the LeaseContractVehicle for the
    // existing dashboard widgets that read it directly.
    if (contractVehicleId) {
      await prisma.leaseContractVehicle.update({
        where: { id: contractVehicleId },
        data: { driverId },
      });
    }

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
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
