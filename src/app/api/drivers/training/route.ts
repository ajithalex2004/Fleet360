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
        const trainings = await tx.driverTraining.findMany({
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(trainings);
      } catch (e) {
        console.error('Error fetching trainings:', e);
        return NextResponse.json({ error: 'Failed to fetch trainings' }, { status: 500 });
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
        const training = await tx.driverTraining.create({ data: body });
        return NextResponse.json(training, { status: 201 });
        } catch (e) {
        console.error('Error creating training:', e);
        return NextResponse.json({ error: 'Failed to create training' }, { status: 500 });
      }
  });
}

