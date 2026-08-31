export const dynamic = 'force-dynamic';

/**
 * /api/leasing/documents/[id] — PATCH + DELETE single document.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch documents from
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
    const existing = await prisma.leaseDocument.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const doc = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseDocument.update({
      where: { id: params.id },
      data: { ...body, updatedAt: new Date() },
    }),
    );
    return NextResponse.json(doc);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const existing = await prisma.leaseDocument.findFirst({
    where: { id: params.id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await withTenantRls(prisma, tenantId, async (tx) =>
    tx.leaseDocument.delete({ where: { id: params.id } }),
  );
  return NextResponse.json({ success: true });
}
