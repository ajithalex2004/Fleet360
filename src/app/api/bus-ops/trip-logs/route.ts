import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

        const { searchParams } = new URL(req.url);
        const scheduleId = searchParams.get('scheduleId');
        const logs = await tx.tripLog.findMany({
          where: { tenantId, ...(scheduleId ? { scheduleId } : {}) },
          include: { schedule: { include: { route: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(logs);
    });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}


export async function POST(req: NextRequest) {

  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const log = await tx.tripLog.create({ data: { ...body, tenantId } });
        return NextResponse.json(log, { status: 201 });
    });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}

