export const dynamic = 'force-dynamic';

/**
 * PATCH /api/leasing/renewals/[id]
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch renewals from
 * another tenant.
 *
 * Accepting a renewal (status -> ACCEPTED) creates the follow-on
 * contract — see src/lib/leasing/renewal-acceptance.ts (shared with the
 * lessee-facing e-sign route at
 * /api/leasing-portal/renewals/[id]/sign, which is the other place a
 * renewal can be accepted from).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { acceptRenewal } from '@/lib/leasing/renewal-acceptance';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseRenewal.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const { originalContract, ...data } = body;

    if (data.status === 'ACCEPTED') {
      const { status, ...extraFields } = data;
      const result = await acceptRenewal({ tenantId, renewalId: params.id, extraFields });
      if (!result) {
        return NextResponse.json({ error: 'Original contract not found' }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    const renewal = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseRenewal.update({
        where: { id: params.id },
        data: { ...data, updatedAt: new Date() },
      }),
    );
    return NextResponse.json(renewal);
  } catch (e) {
    console.error('PATCH /api/leasing/renewals/[id] error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
