export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls, runSequential } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

const CACHE_TAG = 'rental:bookings';

// Runs inside unstable_cache (via cacheRead), which strips Next.js request
// context - next/headers() is unavailable there, so the plain prisma client's
// header-based auto-scoping middleware never engages and RLS (force-applied
// to the runtime role regardless of the WHERE clause) filters out every row
// for every tenant. withTenantRls sets app.tenant_id explicitly from the
// argument instead of relying on headers. findMany + count share ONE
// connection (the tx), so they must run sequentially, not via Promise.all -
// concurrent queries on a single Prisma transaction client are unsupported
// and can interleave in ways that break RLS scoping. See runSequential in
// src/lib/rls.ts.
const getBookings = cacheRead(
  async (
    tenantId: string,
    status: string | null,
    customerId: string | null,
    take: number, skip: number, page: number, limit: number,
  ) => {
    const where = {
      tenantId,
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
    };
    const [data, total] = await withTenantRls(prisma, tenantId, (tx) => runSequential([
      tx.rentalBooking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      tx.rentalBooking.count({ where }),
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
    const customerId = sp.get('customerId');
    const { take, skip, page, limit } = paginate(sp);

    const data = await getBookings(tenantId, status, customerId, take, skip, page, limit);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
    } catch (e) {
    console.error('Error fetching bookings:', e);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
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
    const body = {
      ...stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      ),
      tenantId,
    };
    const booking = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.rentalBooking.create({ data: body as any }),
    );
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(booking, { status: 201 });
    } catch (e) {
    console.error('Error creating booking:', e);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
