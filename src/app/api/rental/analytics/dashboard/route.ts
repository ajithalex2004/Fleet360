/**
 * GET /api/rental/analytics/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns the full RAC KPI dashboard:
 *   - RevPAC, fleet utilization, ADR, ALoR
 *   - Booking funnel + conversion %
 *   - Damage recovery rate
 *   - Per-category breakdown (sorted by revenue)
 *   - Per-channel breakdown (sorted by revenue)
 *
 * Defaults: last 30 days if from/to omitted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeRentalAnalytics } from '@/lib/rental-analytics';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const fromParam = sp.get('from');
    const toParam = sp.get('to');
    const periodTo = toParam ? new Date(toParam) : new Date();
    const periodFrom = fromParam ? new Date(fromParam) : new Date(periodTo.getTime() - 30 * 86400000);

    if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
    }

    // Pull bookings whose period overlaps [periodFrom, periodTo].
    const bookingsRaw = await prisma.rentalBooking.findMany({
      where: {
        deletedAt: null,
        AND: [
          { pickupDate: { lte: periodTo } },
          { dropoffDate: { gte: periodFrom } },
        ],
      },
      select: {
        id: true,
        vehicleCategory: true,
        pickupDate: true,
        dropoffDate: true,
        totalDays: true,
        totalAmount: true,
        channel: true,
        status: true,
      },
    });

    const vehiclesRaw = await prisma.vehicle.findMany({
      where: { deletedAt: null },
      select: { id: true, type: true, status: true },
    });

    const invoicesRaw = await prisma.rentalInvoice.findMany({
      where: {
        deletedAt: null,
        invoiceDate: { gte: periodFrom, lte: periodTo },
      },
      select: { id: true, customerId: true, invoiceDate: true, totalAmount: true, paidAmount: true, currency: true },
    });

    // Damage claims linked to bookings in the period
    const damagesRaw = await prisma.damageClaim.findMany({
      where: {
        booking: {
          AND: [
            { pickupDate: { lte: periodTo } },
            { dropoffDate: { gte: periodFrom } },
          ],
        },
      },
      select: { id: true, bookingId: true, estimatedCost: true, actualCost: true, status: true, billedToCustomer: true },
    });

    const result = computeRentalAnalytics({
      periodFrom,
      periodTo,
      bookings: bookingsRaw.map(b => ({
        id: b.id,
        vehicleCategory: b.vehicleCategory,
        pickupDate: b.pickupDate,
        dropoffDate: b.dropoffDate,
        totalDays: b.totalDays,
        totalAmount: b.totalAmount ? Number(b.totalAmount) : null,
        channel: b.channel,
        status: b.status,
      })),
      vehicles: vehiclesRaw.map(v => ({
        id: v.id,
        category: v.type,
        status: v.status,
      })),
      invoices: invoicesRaw.map(i => ({
        id: i.id,
        customerId: i.customerId,
        invoiceDate: i.invoiceDate,
        totalAmount: Number(i.totalAmount),
        paidAmount: i.paidAmount ? Number(i.paidAmount) : 0,
        currency: i.currency,
      })),
      damageClaims: damagesRaw.map(d => ({
        id: d.id,
        bookingId: d.bookingId,
        estimatedCost: d.estimatedCost ? Number(d.estimatedCost) : null,
        actualCost: d.actualCost ? Number(d.actualCost) : null,
        status: d.status,
        billedToCustomer: d.billedToCustomer,
      })),
    });

    return NextResponse.json(result);
  } catch (err) {
    captureException(err, { context: 'rental.analytics.dashboard' });
    console.error('[rental analytics] error:', err);
    return NextResponse.json({ error: 'Analytics failed' }, { status: 500 });
  }
}
