/**
 * /api/leasing/pre-billing/[id] — PATCH a pre-billing statement.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch statements from
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
    const existing = await prisma.leasePreBillingStatement.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const { contract, ...data } = body;
    if (data.status === 'SENT' && !data.sentAt) data.sentAt = new Date();
    if (data.status === 'CONFIRMED' && !data.confirmedAt) data.confirmedAt = new Date();
    const stmt = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leasePreBillingStatement.update({
      where: { id: params.id },
      data,
    }),
    );
    return NextResponse.json(stmt);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
