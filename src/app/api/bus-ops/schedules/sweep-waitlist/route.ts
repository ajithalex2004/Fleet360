/**
 * POST /api/bus-ops/schedules/sweep-waitlist
 *
 * Daily cron — typically run the evening before the target date.
 *
 * Two-phase sweep:
 *
 *   Phase 1 — process absences:
 *     For each StaffTransportRequest with requestType='TEMPORARY' and
 *     reason starting "ABSENCE" with tripDate inside the window, find that
 *     staff's TripPassenger rows on trips departing the same day and flip
 *     their status from CONFIRMED/BOARDED to ABSENT (only if not already
 *     terminal). The request is then marked FULFILLED.
 *
 *   Phase 2 — auto-fill from waitlist:
 *     For each trip in the window with at least one freed seat, promote
 *     the oldest WAITLISTED passenger to CONFIRMED. Best-effort WhatsApp +
 *     email confirmation to the promoted staff member.
 *
 * Idempotent — re-runnable. Auth: optional CRON_SECRET Bearer.
 *
 * Query: ?dryRun=1 to preview, ?forDate=YYYY-MM-DD to target a specific
 *        date (default tomorrow).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendWhatsApp } from '@/lib/whatsapp';
import { sendEmail } from '@/lib/email';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && !req.headers.get('x-tenant-id')) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  try {
    const sp = req.nextUrl.searchParams;
    const dryRun = sp.get('dryRun') === '1';
    const forDateArg = sp.get('forDate');

    const now = new Date();
    const target = forDateArg && /^\d{4}-\d{2}-\d{2}$/.test(forDateArg)
      ? new Date(forDateArg + 'T00:00:00Z')
      : new Date(now.getTime() + 86400000);
    target.setHours(0, 0, 0, 0);
    const targetEnd = new Date(target.getTime() + 86400000);

    /* ── Phase 1: process absences ─────────────────────────────────── */

    const absenceRequests = await prisma.staffTransportRequest.findMany({
      where: {
        requestType: 'TEMPORARY',
        status: { in: ['PENDING', 'APPROVED'] },
        tripDate: { gte: target, lt: targetEnd },
        reason: { startsWith: 'ABSENCE' },
      },
      select: { id: true, staffMemberId: true, reason: true, tripDate: true },
    });

    interface FreedSeat {
      tripId: string;
      passengerId: string;
      staffMemberId: string;
      staffName: string | null;
    }
    const freedSeats: FreedSeat[] = [];
    const errors: string[] = [];

    for (const ar of absenceRequests) {
      try {
        const passengers = await prisma.tripPassenger.findMany({
          where: {
            staffMemberId: ar.staffMemberId,
            status: { in: ['CONFIRMED'] }, // BOARDED won't happen for tomorrow
            trip: { departureTime: { gte: target, lt: targetEnd }, deletedAt: null },
          },
          select: { id: true, tripId: true },
        });

        const staff = await prisma.staffMember.findUnique({
          where: { id: ar.staffMemberId },
          select: { name: true },
        });

        for (const p of passengers) {
          if (!dryRun) {
            await prisma.tripPassenger.update({
              where: { id: p.id },
              data: { status: 'ABSENT' },
            });
          }
          freedSeats.push({
            tripId: p.tripId,
            passengerId: p.id,
            staffMemberId: ar.staffMemberId,
            staffName: staff?.name ?? null,
          });
        }

        if (!dryRun && passengers.length > 0) {
          await prisma.staffTransportRequest.update({
            where: { id: ar.id },
            data: { status: 'FULFILLED', approvedAt: new Date() },
          });
        }
      } catch (err) {
        errors.push(`absence ${ar.id}: ${err instanceof Error ? err.message : 'failed'}`);
        captureException(err, { context: 'bus-ops.sweep-waitlist.absences', tags: { requestId: ar.id } });
      }
    }

    /* ── Phase 2: auto-fill waitlists ──────────────────────────────── */

    interface Promotion {
      tripId: string;
      tripNumber: string | null;
      promotedPassengerId: string;
      staffMemberId: string;
      staffName: string | null;
      whatsappSent: boolean;
      emailSent: boolean;
    }
    const promotions: Promotion[] = [];

    // Trips that had a seat freed this run (Phase 1) plus any other trips
    // tomorrow with a CONFIRMED-deficit and existing waitlist.
    const tripIdsToCheck = new Set<string>(freedSeats.map(f => f.tripId));

    // Also include trips with capacity headroom + non-empty waitlist (e.g.
    // someone marked ABSENT manually, not via this sweep).
    const tripsWithWaitlist = await prisma.tripSchedule.findMany({
      where: {
        deletedAt: null,
        departureTime: { gte: target, lt: targetEnd },
        status: { in: ['SCHEDULED', 'DEPARTED', 'IN_TRANSIT'] },
        passengers: { some: { status: 'WAITLISTED' } },
      },
      select: { id: true },
    });
    for (const t of tripsWithWaitlist) tripIdsToCheck.add(t.id);

    for (const tid of tripIdsToCheck) {
      try {
        const trip = await prisma.tripSchedule.findUnique({
          where: { id: tid },
          select: {
            id: true, tripNumber: true, departureTime: true, capacity: true, confirmedCount: true,
            route: { select: { name: true } },
          },
        });
        if (!trip) continue;

        // Capacity headroom = capacity - count(CONFIRMED|BOARDED).
        const filled = await prisma.tripPassenger.count({
          where: { tripId: tid, status: { in: ['CONFIRMED', 'BOARDED'] } },
        });
        const headroom = (trip.capacity ?? 0) - filled;
        if (headroom <= 0) continue;

        // Promote in FIFO order.
        const waitlisted = await prisma.tripPassenger.findMany({
          where: { tripId: tid, status: 'WAITLISTED' },
          orderBy: { createdAt: 'asc' },
          take: headroom,
          select: { id: true, staffMemberId: true },
        });
        if (waitlisted.length === 0) continue;

        for (const w of waitlisted) {
          if (!w.staffMemberId) continue;
          const staff = await prisma.staffMember.findUnique({
            where: { id: w.staffMemberId },
            select: { name: true, contactNumber: true, email: true },
          });

          if (!dryRun) {
            await prisma.tripPassenger.update({
              where: { id: w.id },
              data: { status: 'CONFIRMED' },
            });
          }

          let whatsappSent = false, emailSent = false;
          if (!dryRun && staff) {
            const fmtTime = trip.departureTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const body =
              `🎟️ Seat confirmed — Trip ${trip.tripNumber ?? trip.id.slice(0, 8)}\n\n` +
              `Hi ${staff.name?.split(' ')[0] ?? 'there'}, a seat opened up on ${trip.route?.name ?? 'your requested route'}.\n` +
              `Departure: ${target.toISOString().slice(0, 10)} ${fmtTime}\n\n` +
              `You\'ve been promoted from the waitlist. See you on board.\n— Staff Transport`;

            if (staff.contactNumber) {
              const r = await sendWhatsApp({ to: staff.contactNumber, body });
              whatsappSent = r.sent;
            }
            if (staff.email) {
              const r = await sendEmail({
                to: staff.email,
                subject: `Seat confirmed — Trip ${trip.tripNumber ?? trip.id.slice(0, 8)}`,
                text: body,
              });
              emailSent = r.sent;
            }
          }

          promotions.push({
            tripId: tid,
            tripNumber: trip.tripNumber,
            promotedPassengerId: w.id,
            staffMemberId: w.staffMemberId,
            staffName: staff?.name ?? null,
            whatsappSent, emailSent,
          });
        }
      } catch (err) {
        errors.push(`promote on ${tid}: ${err instanceof Error ? err.message : 'failed'}`);
        captureException(err, { context: 'bus-ops.sweep-waitlist.promote', tags: { tripId: tid } });
      }
    }

    if (!dryRun && (freedSeats.length > 0 || promotions.length > 0)) {
      void logAudit({
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: 'SYSTEM',
        entityType: 'TripPassenger',
        action: 'UPDATE',
        details: `Waitlist sweep for ${target.toISOString().slice(0, 10)}: ${freedSeats.length} seats freed (absences), ${promotions.length} promoted from waitlist (${promotions.filter(p => p.whatsappSent).length} WA, ${promotions.filter(p => p.emailSent).length} email), ${errors.length} errors.`,
      });
    }

    return NextResponse.json({
      dryRun,
      forDate: target.toISOString().slice(0, 10),
      runAt: now.toISOString(),
      absenceRequestsProcessed: absenceRequests.length,
      seatsFreed: freedSeats.length,
      tripsScanned: tripIdsToCheck.size,
      promotionsApplied: promotions.length,
      errors,
      freedSeats, promotions,
    });
  } catch (err) {
    captureException(err, { context: 'bus-ops.sweep-waitlist' });
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
