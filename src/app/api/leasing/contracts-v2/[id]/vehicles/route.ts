import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { requireLeaseContractInTenant } from '@/lib/leasing-governance';
import {
  assertFleetVehicleAssignable,
  assertOpeningBranchMatch,
  buildLeaseVehicleDataFromFleet,
  fleetVehicleDisplay,
  loadFleetVehicleForLease,
  mapLeaseVehicleForClient,
  markFleetVehicleLeaseStatus,
  statusForLeaseAssignment,
} from '@/lib/leasing-vehicle-lifecycle';

type ContractVehicleRow = {
  id: string;
  vehicleId?: string | null;
  vehicleType?: string | null;
  type?: string | null;
  make?: string | null;
  model?: string | null;
  licensePlate?: string | null;
  plateNumber?: string | null;
  driverName?: string | null;
  driver?: string | null;
  monthlyRate?: number | string | null;
  status?: string | null;
};

const contractVehicleRepo = (prisma as unknown as {
  leaseContractVehicle: {
    findMany(args: unknown): Promise<ContractVehicleRow[]>;
    create(args: unknown): Promise<ContractVehicleRow>;
  };
}).leaseContractVehicle;

function mapVehicle(v: ContractVehicleRow) {
  return {
    id: v.id,
    vehicleId: v.vehicleId ?? null,
    type: v.vehicleType ?? v.type ?? '',
    make: v.make ?? '',
    model: v.model ?? '',
    licensePlate: v.licensePlate ?? v.plateNumber ?? '',
    driver: v.driverName ?? v.driver ?? '',
    monthlyRate: v.monthlyRate ?? 0,
    status: v.status ?? 'ACTIVE',
  };
}

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'leasing');
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const boundary = await requireLeaseContractInTenant(id, ctx);
    if (boundary) return boundary;
    const vehicles = await contractVehicleRepo.findMany({
      where: { contractId: id },
    });
    return NextResponse.json(vehicles.map(mapVehicle));
  } catch (e: unknown) {
    console.error('GET vehicles error:', e instanceof Error ? e.message : e);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(request, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const boundary = await requireLeaseContractInTenant(id, ctx);
    if (boundary) return boundary;
    const body = await request.json();
    const { vehicleId, monthlyRate, allowCrossBranchOverride } = body;

    if (!vehicleId) {
      return NextResponse.json({ error: 'Select a vehicle from Fleet Master' }, { status: 400 });
    }

    const contract = await prisma.leaseContract2.findUnique({
      where: { id },
      select: { id: true, contractNumber: true, openingBranchId: true, status: true },
    });
    if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });

    const existing = await prisma.leaseContractVehicle.findFirst({
      where: {
        vehicleId,
        status: 'ACTIVE',
        contract: {
          deletedAt: null,
          status: { notIn: ['CLOSED', 'TERMINATED', 'CANCELLED', 'EXPIRED'] },
        },
      },
      select: { id: true, contractId: true },
    });
    if (existing) {
      return NextResponse.json({ error: 'This Fleet vehicle is already linked to another active lease agreement.' }, { status: 409 });
    }

    const fleetVehicle = await loadFleetVehicleForLease(vehicleId, ctx.tenantId);
    const assignmentError = assertFleetVehicleAssignable(fleetVehicle);
    if (assignmentError || !fleetVehicle) {
      return NextResponse.json({ error: assignmentError ?? 'Vehicle is not assignable' }, { status: 409 });
    }

    const branchMismatch = assertOpeningBranchMatch(fleetVehicle, contract.openingBranchId);
    if (branchMismatch) {
      if (!allowCrossBranchOverride) {
        return NextResponse.json(
          {
            error: branchMismatch,
            code: 'CROSS_BRANCH_OVERRIDE_REQUIRED',
            message: 'Enable cross-branch override to queue approval for this assignment.',
          },
          { status: 409 },
        );
      }
      const approval = await requireDangerApproval(request, {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        role: ctx.role,
        isSuperAdmin: ctx.isSuperAdmin,
        isTenantAdmin: ctx.role === 'TENANT_ADMIN',
      }, 'leasing.vehicle_assignment.cross_branch', {
        tenantId: ctx.tenantId,
        targetType: 'LeaseContract',
        targetId: id,
        summary: `Assign ${fleetVehicleDisplay(fleetVehicle)} from another branch to ${contract.contractNumber ?? id}`,
        payload: {
          before: { contract, vehicle: fleetVehicle },
          after: { contractId: id, vehicleId, monthlyRate },
          branchMismatch,
        },
        requiredApprovals: 1,
      });
      if (approval) return approval;
    }

    const vehicle = await contractVehicleRepo.create({
      data: buildLeaseVehicleDataFromFleet(fleetVehicle, id, monthlyRate),
    });
    await markFleetVehicleLeaseStatus(
      vehicleId,
      statusForLeaseAssignment(contract.status),
    );
    await recordOperationalChange({
      req: request,
      ctx,
      entityType: 'LeaseContractVehicle',
      entityId: vehicle.id,
      action: 'CREATE',
      after: vehicle,
      summary: `Assigned Fleet vehicle ${fleetVehicleDisplay(fleetVehicle)} to lease contract ${contract.contractNumber ?? id}`,
      relatedEntityType: 'Vehicle',
      relatedEntityId: vehicleId,
    });

    return NextResponse.json(mapLeaseVehicleForClient(vehicle, fleetVehicle), { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to add vehicle';
    console.error('POST /api/leasing/contracts-v2/[id]/vehicles error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
