import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');

    const exchanges = await prisma.leaseVehicleExchange.findMany({
      where: { ...(contractId ? { contractId } : {}) },
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
  try {
    const body = await req.json();
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
      },
    });
    return NextResponse.json(exchange, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
