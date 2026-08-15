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
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
    const { id } = await ctx.params;
    try {
      await withTenantRls(prisma, tenantId, async (tx) =>
        tx.rentalAncillary.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      }),
      );
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
