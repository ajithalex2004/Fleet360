export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const customer = await tx.rentalCustomer.findUnique({
          where: { id: params.id, tenantId },
          include: {
            bookings: {
              where: { tenantId, deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
        });
        if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(customer);
      } catch (e) {
        console.error('Error fetching customer:', e);
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const { bookings, ...data } = body;
    const customer = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.rentalCustomer.update({
      where: { id: params.id, tenantId },
      data: { ...data, updatedAt: new Date() },
    }),
    );
    return NextResponse.json(customer);
  } catch (e) {
    console.error('Error updating customer:', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    await withTenantRls(prisma, tenantId, async (tx) =>
      tx.rentalCustomer.update({
      where: { id: params.id, tenantId },
      data: { deletedAt: new Date() },
    }),
    );
    return NextResponse.json({ success: true });
    } catch (e) {
    console.error('Error deleting customer:', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
