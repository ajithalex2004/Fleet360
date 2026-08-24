import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

// POST /api/rental/bookings/[id]/extend
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const { newEndDate, reason, approvedBy } = body;
        if (!newEndDate) return NextResponse.json({ error: 'newEndDate is required' }, { status: 400 });

        const booking = await tx.rentalBooking.findUnique({
          where: { id: params.id, tenantId },
          include: { agreement: true },
        });
        if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        if (!['CONFIRMED', 'ACTIVE'].includes(booking.status ?? '')) {
          return NextResponse.json({ error: `Cannot extend a booking in status: ${booking.status}` }, { status: 400 });
        }

        const currentEnd = booking.dropoffDate;
        const newEnd = new Date(newEndDate);
        if (newEnd <= currentEnd) {
          return NextResponse.json({ error: 'New end date must be after the current dropoff date' }, { status: 400 });
        }

        const extraDays = Math.ceil((newEnd.getTime() - currentEnd.getTime()) / (1000 * 60 * 60 * 24));
        const dailyRate = Number(booking.dailyRate ?? 0);
        const extraAmount = extraDays * dailyRate;

        const ops: any[] = [
          tx.rentalBooking.update({
            where: { id: params.id, tenantId },
            data: {
              dropoffDate: newEnd,
              totalDays: (booking.totalDays ?? 0) + extraDays,
              totalAmount: { increment: extraAmount },
              updatedAt: new Date(),
            },
          }),
        ];

        if (booking.agreement) {
          ops.push(
            tx.rentalExtension.create({
              data: {
                tenantId,
                agreementId: booking.agreement.id,
                originalEndDate: currentEnd,
                newEndDate: newEnd,
                extraDays,
                extraAmount,
                reason: reason ?? null,
                approvedBy: approvedBy ?? null,
                status: 'APPROVED',
              },
            }),
            tx.rentalAgreement.update({
              where: { id: booking.agreement.id, tenantId },
              data: {
                endDate: newEnd,
                totalAmount: { increment: extraAmount },
              },
            })
          );
        }

        const results = await tx.$transaction(ops);
        return NextResponse.json({ booking: results[0], extraDays, extraAmount });
        } catch (e) {
        console.error('Error extending booking:', e);
        return NextResponse.json({ error: 'Failed to extend booking' }, { status: 500 });
      }
  });
}

