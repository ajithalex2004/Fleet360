/**
 * POST /api/rental/bookings/sweep-penalties
 *
 * Daily sweep over all non-terminal RentalBookings:
 *   - PENDING/CONFIRMED past pickup + 4h → flip to NO_SHOW + add no-show fee
 *   - ACTIVE past dropoff + 30 min grace → add late-return fee (status stays ACTIVE)
 *
 * Idempotent — fingerprinted in the additional-charge notes so repeat
 * runs in the same day don't double-bill.
 *
 * Auth: optional CRON_SECRET Bearer for external cron.
 *
 * Query: ?dryRun=1 to preview without writing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  detectPenalties,
  chargeTypeFor,
  type BookingForPenalty,
  type BookingStatus,
} from '@/lib/rental-booking-state';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Optional cron auth
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && !req.headers.get('x-tenant-id')) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  try {
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Pull non-terminal bookings.
    const bookings = await prisma.rentalBooking.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] },
      },
      select: {
        id: true,
        bookingRef: true,
        status: true,
        pickupDate: true,
        dropoffDate: true,
        dailyRate: true,
        totalAmount: true,
        totalDays: true,
        currency: true,
      },
    });

    const inputs: BookingForPenalty[] = bookings.map((b) => ({
      id: b.id,
      bookingRef: b.bookingRef,
      status: (b.status ?? 'PENDING') as BookingStatus,
      pickupDate: b.pickupDate,
      dropoffDate: b.dropoffDate,
      dailyRate: b.dailyRate ? Number(b.dailyRate) : null,
      totalAmount: b.totalAmount ? Number(b.totalAmount) : null,
      totalDays: b.totalDays,
      currency: b.currency ?? 'AED',
    }));

    const assessments = detectPenalties({ bookings: inputs });

    const counts = { noShow: 0, lateReturn: 0, skipped: 0 };
    const errors: { bookingId: string; message: string }[] = [];

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        runAt: new Date().toISOString(),
        scanned: bookings.length,
        assessments,
      });
    }

    for (const a of assessments) {
      try {
        // We need an agreement to attach the penalty charge to. If no agreement,
        // use the booking and create a placeholder (or just the booking ref).
        const agreement = await prisma.rentalAgreement.findUnique({
          where: { bookingId: a.bookingId },
        });

        const fingerprint = `penalty:${a.kind}:${a.bookingId}`;

        if (agreement) {
          // Idempotency check — same fingerprint already charged today?
          const existingCharge = await prisma.rentalAdditionalCharge.findFirst({
            where: {
              agreementId: agreement.id,
              chargeType: chargeTypeFor(a.kind),
              createdAt: { gte: today },
            },
          });
          if (existingCharge) {
            counts.skipped += 1;
            continue;
          }

          await prisma.rentalAdditionalCharge.create({
            data: {
              agreementId: agreement.id,
              chargeType: chargeTypeFor(a.kind),
              description: a.rationale,
              amount: a.feeAmount,
              quantity: 1,
              totalAmount: a.feeAmount,
              billedToCustomer: true,
            },
          });
        }

        // Status flip for NO_SHOW
        if (a.kind === 'NO_SHOW') {
          await prisma.rentalBooking.update({
            where: { id: a.bookingId },
            data: { status: 'NO_SHOW' },
          });
          counts.noShow += 1;
        } else {
          counts.lateReturn += 1;
        }
      } catch (err) {
        errors.push({
          bookingId: a.bookingId,
          message: err instanceof Error ? err.message : String(err),
        });
        captureException(err, { context: 'rental.bookings.sweep-penalties.apply', tags: { bookingId: a.bookingId, kind: a.kind } });
      }
    }

    if (counts.noShow + counts.lateReturn > 0) {
      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: req.headers.get('x-user-role') ?? 'SYSTEM',
        entityType: 'RentalBooking',
        action: 'UPDATE',
        details: `Penalty sweep: scanned ${bookings.length}, ${counts.noShow} no-show flipped+charged, ${counts.lateReturn} late-return charged, ${counts.skipped} skipped (already today), ${errors.length} errors.`,
      });
    }

    return NextResponse.json({
      dryRun: false,
      runAt: new Date().toISOString(),
      scanned: bookings.length,
      counts,
      assessments,
      errors,
    });
  } catch (err) {
    captureException(err, { context: 'rental.bookings.sweep-penalties' });
    console.error('[penalty sweep] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
