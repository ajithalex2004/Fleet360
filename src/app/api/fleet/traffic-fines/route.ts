import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

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
    const status = sp.get('status');
    const { take, skip, page, limit } = paginate(sp);
    const where = { ...(vehicleId ? { vehicleId } : {}), ...(status ? { status } : {}) };
    const [data, total] = await Promise.all([
      prisma.trafficFine.findMany({
        where,
        orderBy: { fineDate: 'desc' },
        take,
        skip,
      }),
      prisma.trafficFine.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching traffic fines:', error);
    return NextResponse.json({ error: 'Failed to fetch traffic fines' }, { status: 500 });
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
    const trafficFine = await prisma.trafficFine.create({ data: body });
    return NextResponse.json(trafficFine, { status: 201 });
  } catch (error) {
    console.error('Error creating traffic fine:', error);
    return NextResponse.json({ error: 'Failed to create traffic fine' }, { status: 500 });
  }
}
