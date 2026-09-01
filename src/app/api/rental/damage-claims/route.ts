export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

const CACHE_TAG = 'rental:damage-claims';

// Runs inside unstable_cache (via cacheRead), which strips Next.js request
// context - next/headers() is unavailable there, so the plain prisma client's
// header-based auto-scoping middleware never engages and RLS (force-applied
// to the runtime role regardless of the WHERE clause) filters out every row
// for every tenant. withTenantRls sets app.tenant_id explicitly from the
// argument instead of relying on headers.
const getClaims = cacheRead(
  async (
    tenantId: string,
    status: string | null,
    bookingId: string | null,
    take: number, skip: number, page: number, limit: number,
  ) => {
    const where = { tenantId, deletedAt: null, ...(status ? { status } : {}), ...(bookingId ? { bookingId } : {}) };
    const [data, total] = await withTenantRls(prisma, tenantId, (tx) => Promise.all([
      tx.damageClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      tx.damageClaim.count({ where }),
    ]));
    return paginatedResponse(data, total, page, limit);
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const bookingId = sp.get('bookingId');
    const { take, skip, page, limit } = paginate(sp);
    const data = await getClaims(tenantId, status, bookingId, take, skip, page, limit);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
    } catch (e) {
    console.error('Error fetching damage claims:', e);
    return NextResponse.json({ error: 'Failed to fetch damage claims' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
    const body = { ...stripTenantOwnershipFields((bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>), tenantId };
    const damageClaim = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.damageClaim.create({ data: body }),
    );
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(damageClaim, { status: 201 });
    } catch (e) {
    console.error('Error creating damage claim:', e);
    return NextResponse.json({ error: 'Failed to create damage claim' }, { status: 500 });
  }
}
