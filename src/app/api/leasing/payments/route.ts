/**
 * /api/leasing/payments — V1 collection route.
 *
 * History: written against the V1 `leasePayment` model (removed by
 * Layer 2.6). Now backed by `leasePayment2` with tenant scoping.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { paginate, paginatedResponse } from '@/lib/pagination';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const sp = req.nextUrl.searchParams;
        const contractId = sp.get('contractId');
        const status = sp.get('status');
        const { take, skip, page, limit } = paginate(sp);
        // Filter payments to the caller's tenant by joining through the contract.
        const where = {
          ...(contractId ? { contractId } : {}),
          ...(status ? { status } : {}),
          contract: { tenantId },
        };
        const [data, total] = await Promise.all([
          tx.leasePayment2.findMany({
            where,
            orderBy: { dueDate: 'desc' },
            take,
            skip,
          }),
          tx.leasePayment2.count({ where }),
        ]);
        return NextResponse.json(paginatedResponse(data, total, page, limit));
      } catch (e) {
        console.error('Error fetching payments:', e);
        return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 });
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
    const payment = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leasePayment2.create({
      data: { ...body, tenantId },
    }),
    );
    return NextResponse.json(payment, { status: 201 });
    } catch (e) {
    console.error('Error creating payment:', e);
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 });
  }
}
