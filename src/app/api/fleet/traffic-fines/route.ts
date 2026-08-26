import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

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
        const status = sp.get('status');
        const { take, skip, page, limit } = paginate(sp);
        // tenantId scopes both the page and the count. These tables had no
        // tenant column until 20260907000000 — the driverId/vehicleId filters
        // are optional query params, so with neither supplied this listed
        // every organisation's rows.
        const where = { tenantId, ...(vehicleId ? { vehicleId } : {}), ...(status ? { status } : {}) };
        const [data, total] = await Promise.all([
          tx.trafficFine.findMany({
            where,
            orderBy: { fineDate: 'desc' },
            take,
            skip,
          }),
          tx.trafficFine.count({ where }),
        ]);
        return NextResponse.json(paginatedResponse(data, total, page, limit));
      } catch (e) {
        console.error('Error fetching traffic fines:', e);
        return NextResponse.json({ error: 'Failed to fetch traffic fines' }, { status: 500 });
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
        const trafficFine = await tx.trafficFine.create({ data: { ...body, tenantId } });
        return NextResponse.json(trafficFine, { status: 201 });
        } catch (e) {
        console.error('Error creating traffic fine:', e);
        return NextResponse.json({ error: 'Failed to create traffic fine' }, { status: 500 });
      }
  });
}

