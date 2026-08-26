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
        const fuelCards = await tx.fuelCard.findMany({
          where: { tenantId },
          orderBy: { cardNumber: 'asc' },
        });
        return NextResponse.json(fuelCards);
      } catch (e) {
        console.error('Error fetching fuel cards:', e);
        return NextResponse.json({ error: 'Failed to fetch fuel cards' }, { status: 500 });
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
        const fuelCard = await tx.fuelCard.create({ data: { ...body, tenantId } });
        return NextResponse.json(fuelCard, { status: 201 });
        } catch (e) {
        console.error('Error creating fuel card:', e);
        return NextResponse.json({ error: 'Failed to create fuel card' }, { status: 500 });
      }
  });
}

