import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { attachTenantToEntity, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureRentalGovernance, rentalEntityVisible } from '@/lib/rental-governance';

export async function GET(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const sp = req.nextUrl.searchParams;
    const ctx = requireOperationalContext(req, 'rac', { requestedTenantId: sp.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;

    const status = sp.get('status');
    const customerId = sp.get('customerId');
    const { take, skip, page, limit } = paginate(sp);

    const conditions = ['tenant_id::text = $1'];
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
    const pageParams = [...params, take, skip];

    const [rows, totalRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text
           FROM rental_agreements
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
        ...pageParams,
      ),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
           FROM rental_agreements
          WHERE ${where}`,
        ...params,
      ),
    ]);

    const ids = rows.map(row => row.id);
    if (!ids.length) return NextResponse.json(paginatedResponse([], 0, page, limit));

    const data = await prisma.rentalAgreement.findMany({
      where: { id: { in: ids } },
      include: {
        booking: {
          select: {
            id: true,
            bookingRef: true,
            pickupDate: true,
            dropoffDate: true,
            customer: { select: { id: true, fullName: true, phone: true } },
          },
        },
      },
    });
    const ordered = ids.map(id => data.find(item => item.id === id)).filter(Boolean);
    return NextResponse.json(paginatedResponse(ordered, Number(totalRows[0]?.count ?? 0), page, limit));
  } catch (error) {
    console.error('[rental/agreements] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureRentalGovernance();
  try {
    const ctx = requireOperationalContext(req, 'rac', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
    const bookingId = String(body.bookingId ?? '');
    const customerId = String(body.customerId ?? '');
    if (!bookingId || !customerId) {
      return NextResponse.json({ error: 'bookingId and customerId are required' }, { status: 400 });
    }

    const bookingRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM rental_bookings WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
      bookingId,
      ctx.tenantId,
    ).catch(() => []);
    if (!bookingRows[0]) {
      return NextResponse.json({ error: 'Booking not found for tenant' }, { status: 404 });
    }

    const customerVisible = await rentalEntityVisible('rental_customers', customerId, ctx.tenantId);
    if (!customerVisible) {
      return NextResponse.json({ error: 'Customer not found for tenant' }, { status: 404 });
    }

    const count = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM rental_agreements WHERE tenant_id::text = $1`,
      ctx.tenantId,
    ).catch(() => [{ count: BigInt(0) }]);
    const agreementNo = body.agreementNo ?? `AGR-${String(Number(count[0]?.count ?? 0) + 1).padStart(5, '0')}`;
    const agreement = await prisma.rentalAgreement.create({
      data: { ...body, agreementNo },
    });
    await attachTenantToEntity('rental_agreements', agreement.id, ctx.tenantId);
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'RentalAgreement',
      entityId: agreement.id,
      action: 'CREATE',
      after: agreement,
      summary: `Created rental agreement ${agreement.agreementNo ?? agreement.id}.`,
    });
    return NextResponse.json(agreement, { status: 201 });
  } catch (error) {
    console.error('[rental/agreements] POST error:', error);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
