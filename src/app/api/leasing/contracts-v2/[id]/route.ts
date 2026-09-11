export const dynamic = 'force-dynamic';

/**
 * /api/leasing/contracts-v2/[id] — V2 contract detail route.
 *
 * Tenant scoping: every operation requires x-tenant-id and refuses to read
 * or mutate contracts from another tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getSignature } from '@/lib/leasing/esignature-store';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const contract = await tx.leaseContract2.findFirst({
          where: { id: params.id, tenantId, deletedAt: null },
          include: {
            lessee: true,
            vehicles: true,
            payments2: { orderBy: { dueDate: 'asc' } },
            receipts: { orderBy: { createdAt: 'desc' } },
            exchanges: { orderBy: { exchangeDate: 'desc' } },
            alerts: { orderBy: { createdAt: 'desc' } },
            openingBranch: true,
            closingBranch: true,
            quotation: true,
          },
        });
        if (!contract) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const signature = await getSignature(tenantId, 'CONTRACT', contract.id);
        return NextResponse.json({ ...contract, signature });
      } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(bodyRaw);

      const existing = await tx.leaseContract2.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      // Operational activation rule: activating a contract requires >=1 allocated vehicle
      if (body.status === 'ACTIVE' && existing.status !== 'ACTIVE') {
        const vehicleCount = await (tx as any).leaseContractVehicle.count({
          where: { contractId: params.id, tenantId, status: 'ACTIVE' },
        });
        if (vehicleCount === 0) {
          return NextResponse.json(
            { error: 'Cannot activate contract without allocated vehicles' },
            { status: 400 }
          );
        }
        if (!existing.approvedAt) {
          body.approvedAt = new Date();
        }
      }

      const contract = await tx.leaseContract2.update({
        where: { id: params.id },
        data: { ...body, updatedAt: new Date() },
      });
      return NextResponse.json(contract);
    } catch (e: any) {
      console.error('PATCH /api/leasing/contracts-v2/[id] error:', e?.message);
      return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: e?.status || 500 });
    }
  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const existing = await tx.leaseContract2.findFirst({
        where: { id: params.id, tenantId },
        select: { id: true },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      await tx.leaseContract2.update({
        where: { id: params.id },
        data: { deletedAt: new Date(), status: 'TERMINATED' },
      });
      return NextResponse.json({ success: true });
    } catch (e: any) {
      console.error('DELETE /api/leasing/contracts-v2/[id] error:', e?.message);
      return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: e?.status || 500 });
    }
  });
}
