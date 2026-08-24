/**
 * /api/leasing/direct-debits/[id] — single direct-debit PATCH + DELETE.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch direct debits from
 * another tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseDirectDebit.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const { lessee, ...data } = body;
    if (data.status === 'ACTIVE' && !data.activatedAt) data.activatedAt = new Date();
    const dd = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseDirectDebit.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    }),
    );
    return NextResponse.json(dd);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const existing = await prisma.leaseDirectDebit.findFirst({
    where: { id: params.id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await withTenantRls(prisma, tenantId, async (tx) =>
    tx.leaseDirectDebit.delete({ where: { id: params.id } }),
  );
  return NextResponse.json({ success: true });
}
