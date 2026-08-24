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
        const driverId = sp.get('driverId');
        const status = sp.get('status');
        const { take, skip, page, limit } = paginate(sp);
        const where = { ...(driverId ? { driverId } : {}), ...(status ? { status } : {}) };
        const [data, total] = await Promise.all([
          tx.driverShift.findMany({
            where,
            orderBy: { shiftDate: 'desc' },
            take,
            skip,
          }),
          tx.driverShift.count({ where }),
        ]);
        return NextResponse.json(paginatedResponse(data, total, page, limit));
      } catch (e) {
        console.error('Error fetching shifts:', e);
        return NextResponse.json({ error: 'Failed to fetch shifts' }, { status: 500 });
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
        const shift = await tx.driverShift.create({ data: body });
        return NextResponse.json(shift, { status: 201 });
        } catch (e) {
        console.error('Error creating shift:', e);
        return NextResponse.json({ error: 'Failed to create shift' }, { status: 500 });
      }
  });
}

