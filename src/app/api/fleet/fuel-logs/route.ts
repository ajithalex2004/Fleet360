export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma }         from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { getEventBus }    from '@/events/event-bus';
import { FUEL_FILLED }    from '@/events/registry';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const sp = req.nextUrl.searchParams;
        const vehicleId = sp.get('vehicleId');
        const driverId = sp.get('driverId');
        const { take, skip, page, limit } = paginate(sp);
        // tenantId scopes both the page and the count. These tables had no
        // tenant column until 20260907000000 — the driverId/vehicleId filters
        // are optional query params, so with neither supplied this listed
        // every organisation's rows.
        const where = { tenantId, ...(vehicleId ? { vehicleId } : {}), ...(driverId ? { driverId } : {}) };
        const [data, total] = await Promise.all([
          tx.fuelLog.findMany({
            where,
            orderBy: { fuelDate: 'desc' },
            take,
            skip,
          }),
          tx.fuelLog.count({ where }),
        ]);
        return NextResponse.json(paginatedResponse(data, total, page, limit));
      } catch (e) {
        console.error('Error fetching fuel logs:', e);
        return NextResponse.json({ error: 'Failed to fetch fuel logs' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const fuelLog = await tx.fuelLog.create({ data: { ...body, tenantId } });

        // Publish via outbox — Finance consumer picks this up asynchronously
        // Publishes under the authenticated tenant. This previously read
        // `body.tenantId ?? fuelLog.vehicleId ?? 'default'` — and since
        // stripTenantOwnershipFields removes tenantId from the body above,
        // the first branch was always undefined, so every FUEL_FILLED event
        // was published with a VEHICLE id in its tenantId field, routing
        // Finance consumers to a tenant that does not exist.
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
        } catch (e) {
        console.error('Error creating fuel log:', e);
        return NextResponse.json({ error: 'Failed to create fuel log' }, { status: 500 });
      }
  });
}

