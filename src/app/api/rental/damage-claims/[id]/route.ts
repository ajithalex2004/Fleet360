import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const claim = await tx.damageClaim.findUnique({
          where: { id: params.id, tenantId },
          include: { booking: { include: { customer: true } } },
        });
        if (!claim) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(claim);
      } catch (e) {
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
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
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const { booking, ...data } = body;
    const claim = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.damageClaim.update({ where: { id: params.id, tenantId }, data }),
    );
    return NextResponse.json(claim);
  } catch (e) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    await withTenantRls(prisma, tenantId, async (tx) =>
      tx.damageClaim.delete({ where: { id: params.id, tenantId } }),
    );
    return NextResponse.json({ success: true });
    } catch (e) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
