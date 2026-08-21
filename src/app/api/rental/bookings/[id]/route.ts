import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const booking = await prisma.rentalBooking.findUnique({
      where: { id: params.id },
      include: {
        customer: true,
        inspections: { orderBy: { createdAt: 'desc' } },
        damageClaims: { orderBy: { createdAt: 'desc' } },
        agreement: {
          include: {
            payments: { orderBy: { createdAt: 'desc' } },
            extensions: { orderBy: { createdAt: 'desc' } },
            charges: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
    if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(booking);
  } catch (error) {
    console.error('Error fetching booking:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await req.json();
    const { customer, inspections, damageClaims, agreement, ...data } = body;
    const booking = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.rentalBooking.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
      include: { customer: true },
    }),
    );
    return NextResponse.json(booking);
  } catch (error) {
    console.error('Error updating booking:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    await withTenantRls(prisma, tenantId, async (tx) =>
      tx.rentalBooking.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    }),
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting booking:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
