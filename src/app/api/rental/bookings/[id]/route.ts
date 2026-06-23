import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertStatusTransition,
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;
    const visible = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM rental_bookings WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
      params.id,
      ctx.tenantId,
    ).catch(() => []);
    if (!visible[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    const beforeRows = await prisma.$queryRawUnsafe<Array<{ id: string; status: string | null }>>(
      `SELECT id::text, status FROM rental_bookings WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
      params.id,
      ctx.tenantId,
    ).catch(() => []);
    const before = beforeRows[0];
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const transition = assertStatusTransition('rentalBooking', before.status, body.status);
    if (transition) return transition;
    const data = { ...body };
    delete data.customer;
    delete data.inspections;
    delete data.damageClaims;
    delete data.agreement;
    const booking = await prisma.rentalBooking.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
      include: { customer: true },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalBooking',
      entityId: params.id,
      action: body.status && body.status !== before.status ? 'STATUS_CHANGE' : 'UPDATE',
      before,
      after: booking,
      summary: body.status && body.status !== before.status
        ? `Changed rental booking status from ${before.status} to ${body.status}.`
        : 'Updated rental booking.',
    });
    return NextResponse.json(booking);
  } catch (error) {
    console.error('Error updating booking:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const beforeRows = await prisma.$queryRawUnsafe<Array<{ id: string; status: string | null }>>(
      `SELECT id::text, status FROM rental_bookings WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
      params.id,
      ctx.tenantId,
    ).catch(() => []);
    if (!beforeRows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await prisma.rentalBooking.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalBooking',
      entityId: params.id,
      action: 'DELETE',
      before: beforeRows[0],
      summary: 'Deleted rental booking.',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting booking:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
