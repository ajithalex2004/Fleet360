import { NextRequest, NextResponse } from 'next/server';
import { prisma }         from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { getEventBus }    from '@/events/event-bus';
import { FUEL_FILLED }    from '@/events/registry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const sp = req.nextUrl.searchParams;
    const vehicleId = sp.get('vehicleId');
    const driverId = sp.get('driverId');
    const { take, skip, page, limit } = paginate(sp);
    const where = { ...(vehicleId ? { vehicleId } : {}), ...(driverId ? { driverId } : {}) };
    const [data, total] = await Promise.all([
      prisma.fuelLog.findMany({
        where,
        orderBy: { fuelDate: 'desc' },
        take,
        skip,
      }),
      prisma.fuelLog.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching fuel logs:', error);
    return NextResponse.json({ error: 'Failed to fetch fuel logs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const body = await req.json();
    const fuelLog = await prisma.fuelLog.create({ data: body });

    // Publish via outbox — Finance consumer picks this up asynchronously
    const tenantId = body.tenantId ?? fuelLog.vehicleId ?? 'default';
    getEventBus().publish({
      eventType:     FUEL_FILLED,
      aggregateType: 'FuelLog',
      aggregateId:   fuelLog.id,
      sourceModule:  'fleet',
      tenantId,
      payload: {
        fuelLogId:    fuelLog.id,
        vehicleId:    fuelLog.vehicleId,
        driverId:     fuelLog.driverId   ?? null,
        fuelDate:     fuelLog.fuelDate.toISOString().split('T')[0],
        liters:       fuelLog.liters,
        costPerLiter: fuelLog.costPerLiter ?? null,
        totalCost:    fuelLog.totalCost    ?? null,
        station:      fuelLog.station      ?? null,
      },
    }).catch(err => console.warn('[fuel-logs] outbox publish failed:', err));

    return NextResponse.json(fuelLog, { status: 201 });
  } catch (error) {
    console.error('Error creating fuel log:', error);
    return NextResponse.json({ error: 'Failed to create fuel log' }, { status: 500 });
  }
}
