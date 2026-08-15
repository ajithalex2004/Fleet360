import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
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
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const body = await req.json();
    const { booking, payments, extensions, charges, ...data } = body;
    const agreement = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.rentalAgreement.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    }),
    );
    return NextResponse.json(agreement);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
