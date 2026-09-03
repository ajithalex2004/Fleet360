export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { lockSerialSeries } from '@/lib/leasing/serial-lock';

/**
 * Insurance policies list (GET) + new policy (POST).
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware. Layer 2.5 fix that closes TENANT-001 for the insurance
 * surface.
 */
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
        const status     = searchParams.get('status');
        const now = new Date();
        const policies = await tx.leaseInsurancePolicy.findMany({
          where: {
            tenantId,
            deletedAt: null,
            ...(contractId ? { contractId } : {}),
            ...(status ? { status } : {}),
          },
          include: { claims: { orderBy: { createdAt: 'desc' }, take: 3 } },
          orderBy: { expiryDate: 'asc' },
        });
        // Flag expiring policies (within 30 days)
        const result = policies.map(p => ({
          ...p,
          daysToExpiry: Math.ceil((new Date(p.expiryDate).getTime() - now.getTime()) / 86400000),
        }));
        return NextResponse.json(result);
      } catch (e) {
        console.error('GET /api/leasing/insurance error:', e);
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
    if (body.contractId) {
      const contract = await prisma.leaseContract2.findFirst({
        where: { id: body.contractId, tenantId },
        select: { id: true },
      });
      if (!contract) {
        return NextResponse.json({ error: 'Contract not found in this tenant' }, { status: 404 });
      }
    }
    // <input type="date"> sends a bare "YYYY-MM-DD" string, which Prisma's
    // strict DateTime parser rejects ("premature end of input") — same bug
    // class as the invoices/renewals routes.
    const startDate = body.startDate ? new Date(body.startDate) : new Date();
    const expiryDate = body.expiryDate ? new Date(body.expiryDate) : startDate;
    const policy = await withTenantRls(prisma, tenantId, async (tx) => {
      await lockSerialSeries(tx, tenantId, 'insurance-policy');
      const count = await tx.leaseInsurancePolicy.count({ where: { tenantId } });
      const policyNo = body.policyNo ?? `INS-${String(count + 1).padStart(5, '0')}`;
      return tx.leaseInsurancePolicy.create({
        data: { ...body, startDate, expiryDate, tenantId, policyNo },
      });
    });
    return NextResponse.json(policy, { status: 201 });
    } catch (e) {
    console.error('POST /api/leasing/insurance error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
