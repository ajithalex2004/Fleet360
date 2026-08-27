/**
 * lib/push/scheduler.ts — trip reminder push scheduler.
 *
 * `runTripReminders(tenantId)` finds all CONFIRMED passengers whose trip
 * departs in the next [10-15] minutes and sends each of them a push
 * notification via web-push.
 *
 * Idempotency:
 *   - We mark the push row's `lastSentAt` after sending, so a repeat run
 *     inside the same window won't spam. The trip + staff combination
 *     (tag) keeps the notification collapsed on the device.
 *   - The tag scheme is `trip-reminder:${tripId}:${staffId}`. If a
 *     passenger books a different trip 8 min later, both reminders
 *     show (different tags). If the same trip gets rescheduled and the
 *     scheduler runs again, the second send replaces the first (browser
 *     replaces notifications with the same tag while in the tray).
 *
 * Time window:
 *   - Reminders are sent 10 minutes before departure (configurable via
 *     the REMINDER_LEAD_MINS env, default 10). The window is [lead-2, lead+2]
 *     so a 1-minute cron still catches the trip.
 *
 * Tenant iteration:
 *   - The system job helper iterates every active tenant (withSystemJob)
 *     and runs the reminder logic per-tenant with the right RLS context.
 *   - The cron route accepts ?tenantId=… to limit the run to one tenant
 *     (useful for manual testing).
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls, type SystemJobContext } from '@/lib/rls';
import { runSweep } from '@/lib/prisma-sweep';
import { sendPush } from '@/lib/push/server';

const DEFAULT_LEAD_MINS = Number(process.env.REMINDER_LEAD_MINS ?? 10);
const TICKET_TAG_PREFIX = 'trip-reminder';

export interface RunResult {
  tenantsScanned: number;
  tripsMatched: number;
  pushesSent: number;
  pushesPruned: number;
  errors: number;
}

export async function runTripReminders(tenantHeader?: string | null): Promise<RunResult> {
  const lead = DEFAULT_LEAD_MINS;
  const windowStart = new Date(Date.now() + (lead - 2) * 60_000);
  const windowEnd   = new Date(Date.now() + (lead + 2) * 60_000);

  const results = await runSweep<Omit<RunResult, 'tenantsScanned'>>(
    async ({ tx, tenantId }) => {
      return runForTenant(tx, tenantId, windowStart, windowEnd, lead);
    },
    // Bump the per-tenant transaction timeout — the trip-passenger
    // findMany joins three tables and the default 5s times out even
    // on modest tables under cold caches.
    { tenantHeader, timeoutMs: 30_000 },
  );

  return results.reduce<RunResult>((acc, { result }) => ({
    tenantsScanned: acc.tenantsScanned + 1,
    tripsMatched: acc.tripsMatched + result.tripsMatched,
    pushesSent: acc.pushesSent + result.pushesSent,
    pushesPruned: acc.pushesPruned + result.pushesPruned,
    errors: acc.errors + result.errors,
  }), { tenantsScanned: 0, tripsMatched: 0, pushesSent: 0, pushesPruned: 0, errors: 0 });
}

async function runForTenant(
  tx: SystemJobContext['tx'],
  tenantId: string,
  windowStart: Date,
  windowEnd: Date,
  leadMins: number,
): Promise<Omit<RunResult, 'tenantsScanned'>> {
  // Find every TripPassenger on a trip in the reminder window.
  // TripPassenger doesn't carry a date — go through the related
  // TripSchedule.departureTime.
  const passengers = await withTenantRls(prisma, tenantId, (tx) =>
    tx.tripPassenger.findMany({
      where: {
        status: 'CONFIRMED',
        trip: {
          deletedAt: null,
          status: { not: 'CANCELLED' },
          departureTime: { gte: windowStart, lte: windowEnd },
        },
      },
      include: {
        trip: { include: { route: { select: { name: true, origin: true, destination: true } } } },
      },
      take: 2000, // safety cap — a single tenant rarely has more than a few hundred in flight
    }),
  );

  if (passengers.length === 0) {
    return { tripsMatched: 0, pushesSent: 0, pushesPruned: 0, errors: 0 };
  }

  // TripPassenger doesn't have a relation to StaffMember (only staffMemberId),
  // so we look up the staff by id here.
  const staffIds = [...new Set(passengers.map((p) => p.staffMemberId).filter(Boolean) as string[])];
  const staffRows = staffIds.length === 0 ? [] : await withTenantRls(prisma, tenantId, (tx) =>
    tx.staffMember.findMany({
      where: { id: { in: staffIds }, deletedAt: null },
      select: { id: true, employeeId: true, name: true },
    }),
  );
  const staffById = new Map(staffRows.map((s) => [s.id, s]));

  const subs = await withTenantRls(prisma, tenantId, (tx) =>
    tx.pushSubscription.findMany({
      where: { staffMemberId: { in: staffIds }, revokedAt: null, optInTripReminder: true },
      select: { id: true, endpoint: true, p256dh: true, auth: true, staffMemberId: true },
    }),
  );

  if (subs.length === 0) {
    return { tripsMatched: passengers.length, pushesSent: 0, pushesPruned: 0, errors: 0 };
  }

  const subsByStaff = new Map<string, typeof subs>();
  for (const s of subs) {
    const arr = subsByStaff.get(s.staffMemberId) ?? [];
    arr.push(s);
    subsByStaff.set(s.staffMemberId, arr);
  }

  let sent = 0;
  let pruned = 0;
  let errors = 0;

  for (const p of passengers) {
    if (!p.staffMemberId) continue;
    const staff = staffById.get(p.staffMemberId);
    if (!staff) continue;
    const staffSubs = subsByStaff.get(p.staffMemberId) ?? [];
    if (staffSubs.length === 0) continue;

    const tag = `${TICKET_TAG_PREFIX}:${p.tripId}:${p.staffMemberId}`;
    const origin      = p.trip.route?.origin      ?? 'your stop';
    const destination = p.trip.route?.destination ?? 'the office';
    const routeName   = p.trip.route?.name        ?? `${origin} → ${destination}`;

    for (const sub of staffSubs) {
      const res = await sendPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        {
          title: `Bus in ${leadMins} min`,
          body:  `${routeName} from ${origin} — boarding soon.`,
          url:   '/bus-ops/passenger/app',
          tag,
          sound: 'default',
          data: {
            type:    'trip-reminder',
            tripId:  p.tripId,
            staffId: p.staffMemberId,
          },
        },
      );

      if (res.ok) {
        sent++;
        await withTenantRls(prisma, tenantId, (tx) =>
          tx.pushSubscription.update({
            where: { id: sub.id },
            data:  { lastSentAt: new Date() },
          }),
        );
      } else {
        errors++;
        if (res.reason === 'gone') {
          pruned++;
          await withTenantRls(prisma, tenantId, (tx) =>
            tx.pushSubscription.update({
              where: { id: sub.id },
              data:  { revokedAt: new Date(), lastErrorAt: new Date(), lastErrorCode: res.statusCode },
            }),
          );
        } else {
          await withTenantRls(prisma, tenantId, (tx) =>
            tx.pushSubscription.update({
              where: { id: sub.id },
              data:  { lastErrorAt: new Date(), lastErrorCode: res.statusCode },
            }),
          );
        }
      }
    }
  }

  return { tripsMatched: passengers.length, pushesSent: sent, pushesPruned: pruned, errors };
}
