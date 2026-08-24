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
        const reportSchedules = await tx.reportSchedule.findMany({
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(reportSchedules);
      } catch (e) {
        console.error('Error fetching report schedules:', e);
        return NextResponse.json({ error: 'Failed to fetch report schedules' }, { status: 500 });
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
        const reportSchedule = await tx.reportSchedule.create({ data: body });
        return NextResponse.json(reportSchedule, { status: 201 });
        } catch (e) {
        console.error('Error creating report schedule:', e);
        return NextResponse.json({ error: 'Failed to create report schedule' }, { status: 500 });
      }
  });
}

