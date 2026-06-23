import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { requireLeaseContractInTenant } from '@/lib/leasing-governance';
import {
  assertFleetVehicleAssignable,
  buildLeaseVehicleDataFromFleet,
  fleetVehicleDisplay,
  loadFleetVehicleForLease,
  markFleetVehicleLeaseStatus,
  statusForLeaseAssignment,
} from '@/lib/leasing-vehicle-lifecycle';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'leasing');
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const boundary = await requireLeaseContractInTenant(id, ctx);
    if (boundary) return boundary;
    const exchanges = await prisma.leaseVehicleExchange.findMany({
      where: { contractId: id },
      orderBy: { exchangeDate: 'desc' },
    });
    return NextResponse.json(exchanges);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const boundary = await requireLeaseContractInTenant(id, ctx);
    if (boundary) return boundary;
    const body = await req.json();
    const before = await prisma.leaseContract2.findUnique({
      where: { id },
      include: { vehicles: true },
    });
    if (body.incomingVehicleId) {
      const incoming = await loadFleetVehicleForLease(body.incomingVehicleId, ctx.tenantId);
      const assignmentError = assertFleetVehicleAssignable(incoming);
      if (assignmentError || !incoming) {
        return NextResponse.json({ error: assignmentError ?? 'Incoming vehicle is not assignable' }, { status: 409 });
      }
      const duplicate = await prisma.leaseContractVehicle.findFirst({
        where: {
          vehicleId: body.incomingVehicleId,
          status: 'ACTIVE',
          contract: {
            deletedAt: null,
            status: { notIn: ['CLOSED', 'TERMINATED', 'CANCELLED', 'EXPIRED'] },
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        return NextResponse.json({ error: `${fleetVehicleDisplay(incoming)} is already linked to another live lease agreement.` }, { status: 409 });
      }
    }
    const approval = await requireDangerApproval(req, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: ctx.role,
      isSuperAdmin: ctx.isSuperAdmin,
      isTenantAdmin: ctx.role === 'TENANT_ADMIN',
    }, 'leasing.vehicle_exchange.create', {
      tenantId: ctx.tenantId,
      targetType: 'LeaseContract',
      targetId: id,
      summary: `Queue vehicle exchange for lease contract ${before?.contractNumber ?? id}`,
      payload: { before, after: body },
      requiredApprovals: 2,
    });
    if (approval) return approval;

    const exchange = await prisma.leaseVehicleExchange.create({
      data: {
        ...body,
        contractId: id,
        exchangeDate: body.exchangeDate ? new Date(body.exchangeDate) : new Date(),
        status: body.status ?? 'PENDING',
      },
    });

    // If incoming vehicle provided, update the contract vehicle record
    if (body.incomingVehicleId && body.outgoingVehicleId) {
      const incoming = await loadFleetVehicleForLease(body.incomingVehicleId, ctx.tenantId);
      if (!incoming) return NextResponse.json({ error: 'Incoming vehicle not found' }, { status: 404 });
      await prisma.leaseContractVehicle.updateMany({
        where: { contractId: id, vehicleId: body.outgoingVehicleId },
        data: { status: 'EXCHANGED' },
      });
      await prisma.leaseContractVehicle.create({
        data: buildLeaseVehicleDataFromFleet(
          incoming,
          id,
          body.monthlyRate ?? before?.monthlyRate ?? null,
        ),
      });
      await markFleetVehicleLeaseStatus(body.outgoingVehicleId, 'AVAILABLE', {
        mileage: Number.isFinite(Number(body.outgoingMileage)) ? Number(body.outgoingMileage) : null,
      });
      await markFleetVehicleLeaseStatus(body.incomingVehicleId, statusForLeaseAssignment(before?.status));
    }
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeaseVehicleExchange',
      entityId: exchange.id,
      action: 'CREATE',
      after: exchange,
      summary: `Queued vehicle exchange for lease contract ${id}`,
    });

    return NextResponse.json(exchange, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
