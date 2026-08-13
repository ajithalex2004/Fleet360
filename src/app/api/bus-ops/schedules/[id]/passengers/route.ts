import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    // Verify the parent schedule belongs to this tenant before returning its passengers.
    // Without this, any authenticated tenant could enumerate another tenant's PII
    // (employee names, routes) just by guessing schedule UUIDs.
    const schedule = await prisma.tripSchedule.findFirst({ where: { id: params.id, tenantId }, select: { id: true } });
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const passengers = await prisma.tripPassenger.findMany({
      where: { tripId: params.id, tenantId },
      orderBy: { employeeName: 'asc' },
    });
    return NextResponse.json(passengers);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}
