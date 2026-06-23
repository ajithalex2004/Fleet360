import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance, rentalEntityVisible } from '@/lib/rental-governance';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;
    const visible = await rentalEntityVisible('rental_agreements', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const agreement = await prisma.rentalAgreement.findUnique({
      where: { id: params.id },
      include: {
        booking: { include: { customer: true, inspections: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        extensions: { orderBy: { createdAt: 'desc' } },
        charges: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!agreement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(agreement);
  } catch (error) {
    console.error('[rental/agreements/:id] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const visible = await rentalEntityVisible('rental_agreements', params.id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const { booking, payments, extensions, charges, ...data } = body;
    void booking;
    void payments;
    void extensions;
    void charges;

    const before = await prisma.rentalAgreement.findUnique({ where: { id: params.id } });
    const agreement = await prisma.rentalAgreement.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalAgreement',
      entityId: agreement.id,
      action: 'UPDATE',
      before,
      after: agreement,
      summary: `Updated rental agreement ${agreement.agreementNo ?? agreement.id}.`,
    });
    return NextResponse.json(agreement);
  } catch (error) {
    console.error('[rental/agreements/:id] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
