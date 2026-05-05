import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const exchanges = await prisma.leaseVehicleExchange.findMany({
      where: { contractId: params.id },
      orderBy: { exchangeDate: 'desc' },
    });
    return NextResponse.json(exchanges);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();

    const exchange = await prisma.leaseVehicleExchange.create({
      data: {
        ...body,
        contractId: params.id,
        exchangeDate: body.exchangeDate ? new Date(body.exchangeDate) : new Date(),
        status: body.status ?? 'PENDING',
      },
    });

    // If incoming vehicle provided, update the contract vehicle record
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
