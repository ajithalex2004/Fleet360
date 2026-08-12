/**
 * /api/leasing/vehicle-exchanges — list + create LeaseVehicleExchange rows.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * verify the source contract belongs to the caller's tenant and stamp the
 * new row with the same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');

    const exchanges = await prisma.leaseVehicleExchange.findMany({
      where: {
        tenantId,
        ...(contractId
          ? { contract: { id: contractId, tenantId } }
          : {}),
      },
      include: { contract: { select: { contractNumber: true, lesseeId: true } } },
      orderBy: { exchangeDate: 'desc' },
    });
    return NextResponse.json(exchanges);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: body.contractId, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }
    const exchange = await prisma.leaseVehicleExchange.create({
      data: {
        contractId: body.contractId,
        outgoingVehicleId: body.outgoingVehicleId ?? null,
        incomingVehicleId: body.incomingVehicleId ?? null,
        exchangeDate: body.exchangeDate ? new Date(body.exchangeDate) : new Date(),
        reason: body.reason ?? null,
        approvedBy: body.approvedBy ?? null,
        outgoingMileage: body.outgoingMileage ?? null,
        incomingMileage: body.incomingMileage ?? null,
        notes: body.notes ?? null,
        tenantId,
      },
    });
    return NextResponse.json(exchange, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
