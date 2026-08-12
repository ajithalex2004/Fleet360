/**
 * /api/leasing/contracts-v2/[id]/exchange — list and create vehicle exchanges.
 *
 * Tenant scoping: requires x-tenant-id. The contract must belong to the
 * caller's tenant; the created LeaseVehicleExchange row is stamped with the
 * same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    // Verify contract ownership before exposing exchange history.
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const exchanges = await prisma.leaseVehicleExchange.findMany({
      where: { tenantId, contractId: params.id },
      orderBy: { exchangeDate: 'desc' },
    });
    return NextResponse.json(exchanges);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const body = await req.json();

    const contract = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const exchange = await prisma.leaseVehicleExchange.create({
      data: {
        ...body,
        contractId: params.id,
        exchangeDate: body.exchangeDate ? new Date(body.exchangeDate) : new Date(),
        status: body.status ?? 'PENDING',
        tenantId,
      },
    });

    // If incoming vehicle provided, update the contract vehicle record.
    // LeaseContractVehicle has no tenant_id column (scoped only via the
    // parent contract), so the contractId + ownership check above is
    // sufficient guard.
    if (body.incomingVehicleId && body.outgoingVehicleId) {
      await prisma.leaseContractVehicle.updateMany({
        where: { contractId: params.id, vehicleId: body.outgoingVehicleId },
        data: { vehicleId: body.incomingVehicleId, status: 'EXCHANGED' },
      });
    }

    return NextResponse.json(exchange, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
