/**
 * /api/leasing/contracts — V1 collection route.
 *
 * History: this route was written against the V1 `leaseContract` model. That
 * model was removed by Layer 2.6 (V1/V2 cleanup) and so this file was
 * completely broken — every request failed at compile + runtime.
 *
 * Fix: route the request at the V2 model `leaseContract2` so existing
 * frontend calls keep working. Tenant scope is enforced via x-tenant-id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { assertCanWrite } from '@/lib/access-control';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const lesseeId = sp.get('lesseeId');
    const { take, skip, page, limit } = paginate(sp);
    const where = {
      tenantId,
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(lesseeId ? { lesseeId } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.leaseContract2.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.leaseContract2.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching contracts:', error);
    return NextResponse.json({ error: 'Failed to fetch contracts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = assertCanWrite(req, 'leasing');
  if (guard) return guard;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const body = await req.json();
    const contract = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseContract2.create({
      data: { ...body, tenantId },
    }),
    );
    return NextResponse.json(contract, { status: 201 });
  } catch (error) {
    console.error('Error creating contract:', error);
    return NextResponse.json({ error: 'Failed to create contract' }, { status: 500 });
  }
}
