export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { withAudit } from '@/lib/with-audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { id } = await params;
      try {
        const event = await tx.rateEvent.findUnique({ where: { id, tenantId } });
        if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(event);
      } catch (err) {
        captureException(err, { context: 'rental.rate-events.[id].GET' });
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
      }
  });
}


export const DELETE = withAudit(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
    const { id } = await ctx.params;
    try {
      await withTenantRls(prisma, tenantId, async (tx) =>
        tx.rateEvent.update({
        where: { id, tenantId },
        data: { deletedAt: new Date(), isActive: false },
      }),
      );
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
