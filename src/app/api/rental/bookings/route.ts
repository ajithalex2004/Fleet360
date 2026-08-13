import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

const CACHE_TAG = 'rental:bookings';

// Read-heavy list endpoint (the rental dashboard calls it on every load).
// 30s server cache keeps the trip to Neon off the hot path. Per-tenant
// key keeps responses isolated. Invalidation happens on POST/PATCH/DELETE
// (this file) and on the [id] route.
const getBookings = cacheRead(
  async (
    tenantId: string,
    status: string | null,
    customerId: string | null,
    take: number, skip: number, page: number, limit: number,
  ) => {
    const where = { deletedAt: null, ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) };
    const [data, total] = await Promise.all([
      prisma.rentalBooking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.rentalBooking.count({ where }),
    ]);
    return paginatedResponse(data, total, page, limit);
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const customerId = sp.get('customerId');
    const { take, skip, page, limit } = paginate(sp);
    const tenantId = req.headers.get('x-tenant-id') ?? 'unknown';

    const data = await getBookings(tenantId, status, customerId, take, skip, page, limit);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const booking = await prisma.rentalBooking.create({ data: body });
    // A new booking changes the rental dashboard's active/pending
    // counts and the bookings list — bust the cache.
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    console.error('Error creating booking:', error);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
