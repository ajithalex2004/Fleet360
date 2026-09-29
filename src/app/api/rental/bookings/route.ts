export const dynamic = 'force-dynamic';

import { randomBytes } from 'crypto';
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

// A date input sends "2026-10-01"; the booking columns are timestamps.
function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const bodyRaw = await req.json().catch(() => null);
  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );

  const customerId = text(body.customerId);
  const pickupDate = parseDate(body.pickupDate);
  const dropoffDate = parseDate(body.dropoffDate);
  if (!customerId || !pickupDate || !dropoffDate) {
    return NextResponse.json(
      { error: 'Customer, pickup date and drop-off date are required' },
      { status: 400 },
    );
  }
  if (dropoffDate < pickupDate) {
    return NextResponse.json({ error: 'Drop-off date must be on or after the pickup date' }, { status: 400 });
  }

  const dailyRate = body.dailyRate === undefined || body.dailyRate === null || body.dailyRate === ''
    ? null
    : Number(body.dailyRate);
  if (dailyRate !== null && (!Number.isFinite(dailyRate) || dailyRate < 0)) {
    return NextResponse.json({ error: 'Daily rate must be a positive number' }, { status: 400 });
  }
  const totalDays = Math.max(1, Math.ceil((dropoffDate.getTime() - pickupDate.getTime()) / 86_400_000));

  try {
    const booking = await withTenantRls(prisma, tenantId, async (tx) => {
      const customer = await tx.rentalCustomer.findFirst({
        where: { id: customerId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) return null;

      // RB-yyyymm-nnnn from the tenant's own count; the suffix keeps two
      // bookings made at the same moment from colliding on (tenant, ref).
      const ym = `${pickupDate.getUTCFullYear()}${String(pickupDate.getUTCMonth() + 1).padStart(2, '0')}`;
      const count = await tx.rentalBooking.count({ where: { tenantId } });
      const suffix = randomBytes(2).toString('hex').toUpperCase();
      const bookingRef = `RB-${ym}-${String(count + 1).padStart(4, '0')}-${suffix}`;

      return tx.rentalBooking.create({
        data: {
          tenantId,
          bookingRef,
          customerId,
          vehicleId: text(body.vehicleId),
          vehicleCategory: text(body.vehicleCategory),
          pickupDate,
          dropoffDate,
          pickupLocation: text(body.pickupLocation),
          dropoffLocation: text(body.dropoffLocation),
          totalDays,
          dailyRate,
          totalAmount: dailyRate === null ? null : Math.round(dailyRate * totalDays * 100) / 100,
          channel: text(body.channel) ?? 'DIRECT',
          notes: text(body.notes),
        },
      });
    });
    if (!booking) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 400 });
    }
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(booking, { status: 201 });
  } catch (e) {
    console.error('Error creating booking:', e);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
