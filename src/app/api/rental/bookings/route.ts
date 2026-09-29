export const dynamic = 'force-dynamic';

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls, runSequential } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

// Not cached: booking status changes through confirm, activate, complete,
// cancel, extend, the penalty sweep, channel webhooks and the counter, and a
// cached list showed a confirmed booking as PENDING (so a second Confirm was
// refused). findMany + count share ONE connection (the tx), so they run
// sequentially - see runSequential in src/lib/rls.ts.
async function getBookings(
  tenantId: string,
  status: string | null,
  customerId: string | null,
  take: number, skip: number, page: number, limit: number,
) {
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
      include: { customer: { select: { id: true, fullName: true, email: true, phone: true, nationality: true } } },
    }),
    tx.rentalBooking.count({ where }),
  ]));
  return paginatedResponse(data, total, page, limit);
}

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
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
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
    return NextResponse.json(booking, { status: 201 });
  } catch (e) {
    console.error('Error creating booking:', e);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
