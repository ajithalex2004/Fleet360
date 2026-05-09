import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAudit } from '@/lib/with-audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const item = await prisma.rentalAncillary.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(item);
  } catch (err) {
    captureException(err, { context: 'rental.ancillaries.[id].GET' });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export const DELETE = withAudit(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    try {
      await prisma.rentalAncillary.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      return NextResponse.json({ ok: true, id });
    } catch (err) {
      captureException(err, { context: 'rental.ancillaries.[id].DELETE' });
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
  },
  {
    entityType: 'RentalAncillary',
    action: 'DELETE',
    describe: () => 'Soft-deleted ancillary',
  },
);
