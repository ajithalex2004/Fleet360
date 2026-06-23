import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { attachTenantToEntity, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const sp = req.nextUrl.searchParams;
    const ctx = requireOperationalContext(req, 'rac', { requestedTenantId: sp.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    const status = sp.get('status');
    const customerId = sp.get('customerId');
    const { take, skip, page, limit } = paginate(sp);
    const conditions = ['deleted_at IS NULL', 'tenant_id::text = $1'];
    const params: unknown[] = [ctx.tenantId];
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      conditions.push(`customer_id = $${params.length}`);
    }
    const where = conditions.join(' AND ');
    const dataParams = [...params, take, skip];
    const [data, total] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM rental_bookings WHERE ${where} ORDER BY created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      ),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM rental_bookings WHERE ${where}`,
        ...params,
      ),
    ]);
    return NextResponse.json(paginatedResponse(data.map(rowToCamel), Number(total[0]?.count ?? 0), page, limit));
  } catch (error) {
    console.error('Error fetching bookings:', error);
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    if (!body.customerId && !body.customer_id) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 });
    }
    if (!body.pickupDate && !body.pickup_date) {
      return NextResponse.json({ error: 'pickupDate is required' }, { status: 400 });
    }
    if (!body.dropoffDate && !body.dropoff_date) {
      return NextResponse.json({ error: 'dropoffDate is required' }, { status: 400 });
    }

    const customerId = body.customerId ?? body.customer_id;
    const customerRows = await prisma.$queryRawUnsafe<Array<{ id: string; tenant_id: string | null }>>(
      `SELECT id::text, tenant_id::text AS tenant_id FROM rental_customers WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      customerId,
    ).catch(() => []);
    const customer = customerRows[0];
    if (!customer || (customer.tenant_id && customer.tenant_id !== ctx.tenantId)) {
      return NextResponse.json({ error: 'Customer not found for tenant' }, { status: 404 });
    }
    if (!customer.tenant_id) {
      await attachTenantToEntity('rental_customers', customerId, ctx.tenantId);
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const record = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `INSERT INTO rental_bookings (
         id, booking_ref, customer_id, vehicle_id, vehicle_category,
         pickup_date, dropoff_date, pickup_location, dropoff_location,
         total_days, daily_rate, total_amount, currency, status, channel, notes,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,
         $10,$11,$12,$13,$14,$15,$16,$17::timestamptz,$18::timestamptz
       ) RETURNING *`,
      id,
      body.bookingRef ?? body.booking_ref ?? null,
      customerId,
      body.vehicleId ?? body.vehicle_id ?? null,
      body.vehicleCategory ?? body.vehicle_category ?? null,
      body.pickupDate ?? body.pickup_date,
      body.dropoffDate ?? body.dropoff_date,
      body.pickupLocation ?? body.pickup_location ?? null,
      body.dropoffLocation ?? body.dropoff_location ?? null,
      body.totalDays ?? body.total_days ?? null,
      body.dailyRate ?? body.daily_rate ?? null,
      body.totalAmount ?? body.total_amount ?? null,
      body.currency ?? 'AED',
      body.status ?? 'PENDING',
      body.channel ?? null,
      body.notes ?? null,
      now,
      now,
    );
    await attachTenantToEntity('rental_bookings', id, ctx.tenantId);
    const booking = rowToCamel(record[0]);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalBooking',
      entityId: String(booking.id ?? id),
      action: 'CREATE',
      after: booking,
      summary: `Created rental booking ${booking.bookingRef ?? booking.id}.`,
    });
    const workflow = await triggerServiceWorkflow({
      req,
      ctx,
      serviceTypeKey: 'RAC_RESERVATIONS',
      referenceType: 'RentalBooking',
      referenceId: String(booking.id ?? id),
      referenceNumber: String(booking.bookingRef ?? booking.id ?? id),
      contextData: {
        bookingId: booking.id ?? id,
        customerId,
        vehicleId: booking.vehicleId ?? null,
        pickupDate: booking.pickupDate ?? null,
        dropoffDate: booking.dropoffDate ?? null,
        totalAmount: booking.totalAmount ?? null,
        status: booking.status ?? 'PENDING',
      },
    });
    return NextResponse.json({ ...booking, workflow }, { status: 201 });
  } catch (error) {
    console.error('Error creating booking:', error);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
