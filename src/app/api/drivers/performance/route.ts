export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const performances = await tx.driverPerformance.findMany({
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(performances);
      } catch (e) {
        console.error('Error fetching performances:', e);
        return NextResponse.json({ error: 'Failed to fetch performances' }, { status: 500 });
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
        const performance = await tx.driverPerformance.create({ data: body });
        return NextResponse.json(performance, { status: 201 });
        } catch (e) {
        console.error('Error creating performance:', e);
        return NextResponse.json({ error: 'Failed to create performance' }, { status: 500 });
      }
  });
}

