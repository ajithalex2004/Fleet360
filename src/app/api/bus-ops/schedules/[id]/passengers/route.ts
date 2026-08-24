import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
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
