export const dynamic = 'force-dynamic';

/**
 * /api/leasing/mileage-overages/[id] — single overage PATCH.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch overages from
 * another tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseMileageOverage.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const { contract, ...data } = body;
    const overage = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseMileageOverage.update({
      where: { id: params.id },
      data,
    }),
    );
    return NextResponse.json(overage);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
