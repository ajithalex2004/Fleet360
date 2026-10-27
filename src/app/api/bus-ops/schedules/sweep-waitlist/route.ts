export const dynamic = 'force-dynamic';

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
 *     email confirmation to the promoted staff member, in the tenant's
 *     wording (email template staff_transport.seat_confirmed), sent after
 *     the transaction commits.
 *
 * Idempotent — re-runnable. Auth: optional CRON_SECRET Bearer.
 *
 * Query: ?dryRun=1 to preview, ?forDate=YYYY-MM-DD to target a specific
 *        date (default tomorrow).
 *
 * Tenant scoping (2026-08-13):
 *   - When called with an operator session (x-tenant-id header set by
 *     the auth middleware), the sweep is scoped to that single tenant.
 *     This prevents a platform-wide scan that hit the Prisma transaction
 *     timeout on the shared dev DB and leaked cross-tenant data into
 *     per-tenant notifications.
 *   - When called with the CRON_SECRET bearer (no x-tenant-id), the
 *     sweep remains a platform-wide operation. If you need to limit a
 *     cron run to a specific tenant, pass ?tenantId=... in the query.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { sendWhatsApp } from '@/lib/whatsapp';
import { sendEmail } from '@/lib/email';
import { loadEmailTemplate } from '@/lib/email-templates';
import { SEAT_CONFIRMED_KEY, firstName, formatTripTime } from '@/lib/bus-ops/trip-notices';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { TRIP_OPEN_STATUSES } from '@/lib/trip-status';
export const runtime = 'nodejs';

interface Promotion {
  tripId: string;
  tripNumber: string | null;
  promotedPassengerId: string;
  staffMemberId: string;
  staffName: string | null;
  whatsappSent: boolean;
  emailSent: boolean;
}

interface SweepSummary {
  dryRun: boolean;
  forDate: string;
  runAt: string;
  absenceRequestsProcessed: number;
  seatsFreed: number;
  tripsScanned: number;
  promotionsApplied: number;
  errors: string[];
  freedSeats: unknown[];
  promotions: Promotion[];
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // Seat confirmations to send once the transaction has committed.
  const seatNotices: Array<{
    promotion: Promotion;
    name: string | null; phone: string | null; email: string | null;
    tripNumber: string; routeName: string | null; departureDate: string; departureTime: string;
  }> = [];
  // Set by the transaction on success (an object, so TypeScript doesn't
  // narrow it to null across the callback).
  const outcome: { summary: SweepSummary | null } = { summary: null };

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
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

        // Tenant scoping: prefer the session's x-tenant-id header, fall back
        // to an explicit ?tenantId= query param, then no scope (platform cron).
        // Using a string | undefined filter so Prisma generates a clean
        // parameterized WHERE clause.
        const sessionTenantId = req.headers.get('x-tenant-id') ?? null;
        const queryTenantId  = sp.get('tenantId') ?? null;
        const tenantScope    = sessionTenantId ?? queryTenantId; // null = no scope

        const now = new Date();
        const target = forDateArg && /^\d{4}-\d{2}-\d{2}$/.test(forDateArg)
          ? new Date(forDateArg + 'T00:00:00Z')
          : new Date(now.getTime() + 86400000);
        target.setHours(0, 0, 0, 0);
        const targetEnd = new Date(target.getTime() + 86400000);

        /* ── Phase 1: process absences ─────────────────────────────────── */

        const absenceRequests = await tx.staffTransportRequest.findMany({
          where: {
            requestType: 'TEMPORARY',
            status: { in: ['PENDING', 'APPROVED'] },
            tripDate: { gte: target, lt: targetEnd },
            reason: { startsWith: 'ABSENCE' },
            ...(tenantScope ? { tenantId: tenantScope } : {}),
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
            const passengers = await tx.tripPassenger.findMany({
              where: {
                staffMemberId: ar.staffMemberId,
                status: { in: ['CONFIRMED'] }, // BOARDED won't happen for tomorrow
                trip: { departureTime: { gte: target, lt: targetEnd }, deletedAt: null },
                // Same tenantScope filter the absence query above applies.
                // Omitting it here meant a scoped run still swept passenger
                // rows belonging to other tenants.
                ...(tenantScope ? { tenantId: tenantScope } : {}),
              },
              select: { id: true, tripId: true },
            });

            const staff = await tx.staffMember.findUnique({
              where: { id: ar.staffMemberId },
              select: { name: true },
            });

            for (const p of passengers) {
              if (!dryRun) {
                await tx.tripPassenger.update({
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
              await tx.staffTransportRequest.update({
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

        const promotions: Promotion[] = [];

        // Trips that had a seat freed this run (Phase 1) plus any other trips
        // tomorrow with a CONFIRMED-deficit and existing waitlist.
        const tripIdsToCheck = new Set<string>(freedSeats.map(f => f.tripId));

        // Also include trips with capacity headroom + non-empty waitlist (e.g.
        // someone marked ABSENT manually, not via this sweep).
        const tripsWithWaitlist = await tx.tripSchedule.findMany({
          where: {
            deletedAt: null,
            departureTime: { gte: target, lt: targetEnd },
            status: { in: [...TRIP_OPEN_STATUSES] },
            passengers: { some: { status: 'WAITLISTED' } },
            ...(tenantScope ? { tenantId: tenantScope } : {}),
          },
          select: { id: true },
        });
        for (const t of tripsWithWaitlist) tripIdsToCheck.add(t.id);

        for (const tid of tripIdsToCheck) {
          try {
            const trip = await tx.tripSchedule.findUnique({
              where: { id: tid },
              select: {
                id: true, tripNumber: true, departureTime: true, capacity: true, confirmedCount: true,
                route: { select: { name: true } },
              },
            });
            if (!trip) continue;

            // Capacity headroom = capacity - count(CONFIRMED|BOARDED).
            const filled = await tx.tripPassenger.count({
              where: {
                tripId: tid,
                status: { in: ['CONFIRMED', 'BOARDED'] },
                ...(tenantScope ? { tenantId: tenantScope } : {}),
              },
            });
            const headroom = (trip.capacity ?? 0) - filled;
            if (headroom <= 0) continue;

            // Promote in FIFO order.
            const waitlisted = await tx.tripPassenger.findMany({
              where: {
                tripId: tid,
                status: 'WAITLISTED',
                ...(tenantScope ? { tenantId: tenantScope } : {}),
              },
              orderBy: { createdAt: 'asc' },
              take: headroom,
              select: { id: true, staffMemberId: true },
            });
            if (waitlisted.length === 0) continue;

            for (const w of waitlisted) {
              if (!w.staffMemberId) continue;
              const staff = await tx.staffMember.findUnique({
                where: { id: w.staffMemberId },
                select: { name: true, contactNumber: true, email: true },
              });

              if (!dryRun) {
                await tx.tripPassenger.update({
                  where: { id: w.id },
                  data: { status: 'CONFIRMED' },
                });
              }

              const promotion: Promotion = {
                tripId: tid,
                tripNumber: trip.tripNumber,
                promotedPassengerId: w.id,
                staffMemberId: w.staffMemberId,
                staffName: staff?.name ?? null,
                whatsappSent: false, emailSent: false,
              };
              promotions.push(promotion);
              if (!dryRun && staff && (staff.contactNumber || staff.email)) {
                seatNotices.push({
                  promotion,
                  name: staff.name, phone: staff.contactNumber, email: staff.email,
                  tripNumber: trip.tripNumber ?? trip.id.slice(0, 8),
                  routeName: trip.route?.name ?? null,
                  departureDate: target.toISOString().slice(0, 10),
                  departureTime: formatTripTime(trip.departureTime),
                });
              }
            }
          } catch (err) {
            errors.push(`promote on ${tid}: ${err instanceof Error ? err.message : 'failed'}`);
            captureException(err, { context: 'bus-ops.sweep-waitlist.promote', tags: { tripId: tid } });
          }
        }

        outcome.summary = {
          dryRun,
          forDate: target.toISOString().slice(0, 10),
          runAt: now.toISOString(),
          absenceRequestsProcessed: absenceRequests.length,
          seatsFreed: freedSeats.length,
          tripsScanned: tripIdsToCheck.size,
          promotionsApplied: promotions.length,
          errors,
          freedSeats, promotions,
        };
        return null;
        } catch (err) {
        captureException(err, { context: 'bus-ops.sweep-waitlist' });
        return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
      }
  });
  const summary = outcome.summary;
  if (response || !summary) return response ?? NextResponse.json({ error: 'Sweep failed' }, { status: 500 });

  if (seatNotices.length > 0) {
    try {
      const template = await loadEmailTemplate({ tenantId, key: SEAT_CONFIRMED_KEY });
      for (const n of seatNotices) {
        const msg = template.render({
          values: {
            staffName: firstName(n.name),
            tripNumber: n.tripNumber,
            routeName: n.routeName ?? '',
            departureDate: n.departureDate,
            departureTime: n.departureTime,
          },
        });
        if (n.phone) n.promotion.whatsappSent = (await sendWhatsApp({ to: n.phone, body: msg.text })).sent;
        if (n.email) n.promotion.emailSent = (await sendEmail({ to: n.email, subject: msg.subject, html: msg.html, text: msg.text })).sent;
      }
    } catch (err) {
      captureException(err, { context: 'bus-ops.sweep-waitlist.notify', tags: { tenantId } });
    }
  }

  const { promotions, errors } = summary;
  if (!summary.dryRun && (summary.seatsFreed > 0 || promotions.length > 0)) {
    await logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? 'system:cron',
      userRole: 'SYSTEM',
      entityType: 'TripPassenger',
      action: 'UPDATE',
      details: `Waitlist sweep for ${summary.forDate}: ${summary.seatsFreed} seats freed (absences), ${promotions.length} promoted from waitlist (${promotions.filter(p => p.whatsappSent).length} WA, ${promotions.filter(p => p.emailSent).length} email), ${errors.length} errors.`,
    });
  }
  return NextResponse.json(summary);
}

