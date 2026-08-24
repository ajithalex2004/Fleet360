import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

// POST /api/rental/bookings/[id]/cancel
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
        const booking = await tx.rentalBooking.findUnique({ where: { id: params.id, tenantId } });
        if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
        if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
          return NextResponse.json({ error: `Cannot cancel a booking in status: ${booking.status}` }, { status: 400 });
        }

        const ops: any[] = [
          tx.rentalBooking.update({
            where: { id: params.id, tenantId },
            data: {
              status: 'CANCELLED',
              notes: body.reason ? `CANCELLED: ${body.reason}${booking.notes ? '\n' + booking.notes : ''}` : booking.notes,
              updatedAt: new Date(),
            },
          }),
        ];

        // Cancel linked agreement if exists
        const agreement = await tx.rentalAgreement.findUnique({ where: { bookingId: params.id, tenantId } });
        if (agreement) {
          ops.push(
            tx.rentalAgreement.update({
              where: { id: agreement.id, tenantId },
              data: { status: 'CANCELLED' },
            })
          );
        }

        const results = await tx.$transaction(ops);
        return NextResponse.json({ booking: results[0] });
        } catch (e) {
        console.error('Error cancelling booking:', e);
        return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 });
      }
  });
}

