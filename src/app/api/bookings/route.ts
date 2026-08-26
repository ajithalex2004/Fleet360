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
        const sp          = req.nextUrl.searchParams;
        const serviceType = sp.get('serviceType');
        const status      = sp.get('status');
        const limit       = Math.min(parseInt(sp.get('limit') ?? '200', 10), 500);

        // NOTE: bookings.tenant_id is uuid (most of this schema uses text) and
        // every existing row has it NULL, so scoping hides those rows from every
        // tenant. That is correct — a row belonging to no tenant should not
        // appear under one — but it means a previously-populated list can go
        // empty until those rows are assigned an owner.
        const where: Record<string, unknown> = { tenantId, deletedAt: null };
        if (serviceType) where.serviceType = serviceType;
        if (status)      where.status      = status;

        const bookings = await tx.booking.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        });
        return NextResponse.json(bookings);
      } catch (e) {
        console.error('Error fetching bookings:', e);
        return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
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
        const booking = await tx.booking.create({ data: body });
        return NextResponse.json(booking, { status: 201 });
        } catch (e) {
        console.error('Error creating booking:', e);
        return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
      }
  });
}

