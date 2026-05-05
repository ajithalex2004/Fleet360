import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAudit } from '@/lib/with-audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const event = await prisma.rateEvent.findUnique({ where: { id } });
    if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(event);
  } catch (err) {
    captureException(err, { context: 'rental.rate-events.[id].GET' });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export const DELETE = withAudit(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    try {
      await prisma.rateEvent.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      return NextResponse.json({ ok: true, id });
    } catch (err) {
      captureException(err, { context: 'rental.rate-events.[id].DELETE' });
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
  },
  {
    entityType: 'RateEvent',
    action: 'DELETE',
    describe: () => 'Soft-deleted rate event',
  },
);
