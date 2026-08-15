/**
 * /api/leasing/early-terminations/[id] — single termination detail + PATCH.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch terminations from
 * another tenant.
 */

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
  const item = await prisma.leaseEarlyTermination.findFirst({
    where: { id: params.id, tenantId },
    include: { contract: true },
  });
  return item
    ? NextResponse.json(item)
    : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseEarlyTermination.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true, contractId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const { contract, ...data } = body;
    if (data.status === 'APPROVED' && !data.approvedAt) data.approvedAt = new Date();
    const item = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseEarlyTermination.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    }),
    );
    // If executed, update contract status (also tenant-scoped).
    if (data.status === 'EXECUTED') {
      const owned = await prisma.leaseContract2.findFirst({
        where: { id: item.contractId, tenantId },
        select: { id: true },
      });
      if (owned) {
        await withTenantRls(prisma, tenantId, async (tx) =>
          tx.leaseContract2.update({
          where: { id: item.contractId },
          data: { status: 'TERMINATED' },
        }),
        );
      }
    }
    return NextResponse.json(item);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
