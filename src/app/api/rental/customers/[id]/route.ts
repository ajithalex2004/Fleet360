import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance, rentalEntityVisible } from '@/lib/rental-governance';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;
    const visible = await rentalEntityVisible('rental_customers', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const customer = await prisma.rentalCustomer.findUnique({
      where: { id: params.id },
      include: {
        bookings: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error fetching customer:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const visible = await rentalEntityVisible('rental_customers', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const body = await req.json();
    const { bookings, ...data } = body;
    void bookings;
    const before = await prisma.rentalCustomer.findUnique({ where: { id: params.id } });
    const customer = await prisma.rentalCustomer.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalCustomer',
      entityId: customer.id,
      action: 'UPDATE',
      before,
      after: customer,
      summary: `Updated RAC customer ${customer.fullName}.`,
    });
    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error updating customer:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const visible = await rentalEntityVisible('rental_customers', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const before = await prisma.rentalCustomer.findUnique({ where: { id: params.id } });
    await prisma.rentalCustomer.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalCustomer',
      entityId: params.id,
      action: 'DELETE',
      before,
      summary: 'Deleted RAC customer.',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
