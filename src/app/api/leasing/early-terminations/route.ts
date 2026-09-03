export const dynamic = 'force-dynamic';

/**
 * /api/leasing/early-terminations — list + create LeaseEarlyTermination.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * verify the source contract belongs to the caller's tenant and stamp the
 * new termination with the same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const contractId = searchParams.get('contractId');
        const items = await tx.leaseEarlyTermination.findMany({
          where: {
            tenantId,
            ...(contractId
              ? { contract: { id: contractId, tenantId } }
              : {}),
          },
          include: { contract: { select: { contractNumber: true, monthlyRate: true, endDate: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(items);
      } catch (e) {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: body.contractId, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }
    const penaltyPct = parseFloat(body.penaltyPct || '20');
    const monthlyRate = parseFloat(body.monthlyRate || '0');
    const remainingMonths = parseInt(body.remainingMonths || '0');
    const penaltyAmount = (penaltyPct / 100) * monthlyRate * remainingMonths;
    const outstanding = parseFloat(body.outstandingPayments || '0');
    const depositRefund = parseFloat(body.depositRefund || '0');
    const totalSettlement = penaltyAmount + outstanding - depositRefund;
    const et = await withTenantRls(prisma, tenantId, async (tx) => {
      await lockSerialSeries(tx, tenantId, 'early-termination');
      const count = await tx.leaseEarlyTermination.count({ where: { tenantId } });
      const terminationNo = `ET-${String(count + 1).padStart(5, '0')}`;
      return tx.leaseEarlyTermination.create({
        data: { ...body, terminationNo, penaltyAmount, totalSettlement, tenantId },
      });
    });
    return NextResponse.json(et, { status: 201 });
    } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
