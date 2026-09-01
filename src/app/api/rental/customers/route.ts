export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

const CACHE_TAG = 'rental:customers';

// Runs inside unstable_cache (via cacheRead), which strips Next.js request
// context - next/headers() is unavailable there, so the plain prisma client's
// header-based auto-scoping middleware never engages and RLS (force-applied
// to the runtime role regardless of the WHERE clause) filters out every row
// for every tenant. withTenantRls sets app.tenant_id explicitly from the
// argument instead of relying on headers.
const getCustomers = cacheRead(
  async (tenantId: string) => {
    return withTenantRls(prisma, tenantId, (tx) => tx.rentalCustomer.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    }));
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({headers: req.headers, nextUrl: req.nextUrl});
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const customers = await getCustomers(tenantId);
    return NextResponse.json(customers, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
    } catch (e) {
    console.error('Error fetching customers:', e);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({headers: req.headers, nextUrl: req.nextUrl});
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const bodyRaw = await req.json();
    const body = { ...stripTenantOwnershipFields((bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>), tenantId };
    const customer = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.rentalCustomer.create({ data: body }),
    );
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(customer, { status: 201 });
    } catch (e) {
    console.error('Error creating customer:', e);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
