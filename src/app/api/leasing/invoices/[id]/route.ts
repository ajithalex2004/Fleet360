import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

/**
 * Single-lease-invoice GET / PATCH.
 *
 * Multi-tenant: `findFirst` enforces x-tenant-id from the middleware.
 * Returns 404 (not 403) on cross-tenant probes to avoid leaking
 * row existence.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const inv = await tx.leaseInvoice.findFirst({
        where: { id: params.id, tenantId },
        include: { lines: true, lessee: true },
      });
      return inv
        ? NextResponse.json(inv)
        : NextResponse.json({ error: 'Not found' }, { status: 404 });
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
    // Verify tenant ownership before update.
    const existing = await prisma.leaseInvoice.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const { lines, lessee, ...data } = body;
    if (data.status === 'SENT' && !data.sentAt) data.sentAt = new Date();
    if (data.status === 'PAID' && !data.paidAt) data.paidAt = new Date();
    const inv = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseInvoice.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    }),
    );
    return NextResponse.json(inv);
  } catch (e) {
    console.error('PATCH /api/leasing/invoices/[id] error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
