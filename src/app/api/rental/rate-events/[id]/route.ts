import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance, rentalEntityVisible } from '@/lib/rental-governance';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureRentalGovernance();
  const { id } = await params;
  try {
    const ctx = requireOperationalContext(req, 'rac');
    if (ctx instanceof NextResponse) return ctx;

    const visible = await rentalEntityVisible('rate_events', id, ctx.tenantId, { includeGlobal: true });
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const event = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT *
         FROM rate_events
        WHERE id = $1
          AND (tenant_id::text = $2 OR tenant_id IS NULL OR tenant_id::text = 'GLOBAL')
        LIMIT 1`,
      id,
      ctx.tenantId,
    );
    if (!event[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(event[0]);
  } catch (error) {
    captureException(error, { context: 'rental.rate-events.[id].GET' });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureRentalGovernance();
  const { id } = await params;
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const visible = await rentalEntityVisible('rate_events', id, ctx.tenantId);
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const before = await prisma.rateEvent.findUnique({ where: { id } });
    await prisma.rateEvent.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RateEvent',
      entityId: id,
      action: 'DELETE',
      before,
      summary: 'Soft-deleted rate event.',
    });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    captureException(error, { context: 'rental.rate-events.[id].DELETE' });
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
