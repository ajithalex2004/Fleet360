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

import type { Prisma } from '@prisma/client';
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

/**
 * A subscription reminded within this many minutes is skipped: the reminder
 * window is 4 minutes wide and the cron runs every minute, so without it
 * each passenger was pushed on every run inside the window. (lastSentAt was
 * written but never read.)
 */
const RESEND_GUARD_MINS = 5;

/** One push to send: who, where, and what. */
interface PlannedPush {
  tenantId: string;
  subscriptionId: string;
  target: { endpoint: string; p256dh: string; auth: string };
  payload: Parameters<typeof sendPush>[1];
}

export async function runTripReminders(tenantHeader?: string | null): Promise<RunResult> {
  const lead = DEFAULT_LEAD_MINS;
  const now = Date.now();
  const windowStart = new Date(now + (lead - 2) * 60_000);
  const windowEnd   = new Date(now + (lead + 2) * 60_000);
  const sentBefore  = new Date(now - RESEND_GUARD_MINS * 60_000);

  // 1. Plan, per tenant, inside its RLS transaction: database reads only.
  //    The pushes used to be sent from inside this transaction — up to 2,000
  //    HTTPS calls holding it open against its 30 s timeout; a timeout rolled
  //    back the lastSentAt updates of pushes already delivered.
  const planned = await runSweep<{ tripsMatched: number; pushes: PlannedPush[] }>(
    async ({ tx, tenantId }) => planForTenant(tx, tenantId, windowStart, windowEnd, sentBefore, lead),
    // Bump the per-tenant transaction timeout — the trip-passenger
    // findMany joins three tables and the default 5s times out even
    // on modest tables under cold caches.
    { tenantHeader, timeoutMs: 30_000 },
  );

  // 2. Send, outside any transaction; record each outcome in its own write.
  let pushesSent = 0;
  let pushesPruned = 0;
  let errors = 0;
  // Record one push's outcome without stopping the run: updateMany does not
  // throw when the subscription was deleted since planning, and any other
  // failure is counted, so every remaining planned push is still sent.
  const recordOutcome = async (push: PlannedPush, data: Prisma.PushSubscriptionUpdateManyMutationInput) => {
    try {
      await withTenantRls(prisma, push.tenantId, (tx) =>
        tx.pushSubscription.updateMany({ where: { id: push.subscriptionId }, data }),
      );
    } catch (e) {
      errors++;
      console.error('[push-scheduler] could not record push outcome:', push.subscriptionId, e instanceof Error ? e.message : e);
    }
  };
  for (const { result } of planned) {
    for (const push of result.pushes) {
      const res = await sendPush(push.target, push.payload);
      if (res.ok) {
        pushesSent++;
        await recordOutcome(push, { lastSentAt: new Date() });
        continue;
      }
      errors++;
      const gone = res.reason === 'gone';
      if (gone) pushesPruned++;
      await recordOutcome(push, gone
        ? { revokedAt: new Date(), lastErrorAt: new Date(), lastErrorCode: res.statusCode }
        : { lastErrorAt: new Date(), lastErrorCode: res.statusCode });
    }
  }

  return {
    tenantsScanned: planned.length,
    tripsMatched: planned.reduce((n, { result }) => n + result.tripsMatched, 0),
    pushesSent,
    pushesPruned,
    errors,
  };
}

async function planForTenant(
  tx: SystemJobContext['tx'],
  tenantId: string,
  windowStart: Date,
  windowEnd: Date,
  sentBefore: Date,
  leadMins: number,
): Promise<{ tripsMatched: number; pushes: PlannedPush[] }> {
  // Find every TripPassenger on a trip in the reminder window.
  // TripPassenger doesn't carry a date — go through the related
  // TripSchedule.departureTime.
  const passengers = await tx.tripPassenger.findMany({
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
  });
  if (passengers.length === 0) return { tripsMatched: 0, pushes: [] };

  // TripPassenger doesn't have a relation to StaffMember (only staffMemberId),
  // so we look up the staff by id here.
  const staffIds = [...new Set(passengers.map((p) => p.staffMemberId).filter(Boolean) as string[])];
  if (staffIds.length === 0) return { tripsMatched: passengers.length, pushes: [] };
  const staffRows = await tx.staffMember.findMany({
    where: { id: { in: staffIds }, deletedAt: null },
    select: { id: true },
  });
  const knownStaff = new Set(staffRows.map((s) => s.id));

  const subs = await tx.pushSubscription.findMany({
    where: {
      staffMemberId: { in: staffIds }, revokedAt: null, optInTripReminder: true,
      OR: [{ lastSentAt: null }, { lastSentAt: { lt: sentBefore } }],
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true, staffMemberId: true },
  });
  const subsByStaff = new Map<string, typeof subs>();
  for (const s of subs) {
    const arr = subsByStaff.get(s.staffMemberId) ?? [];
    arr.push(s);
    subsByStaff.set(s.staffMemberId, arr);
  }

  const pushes: PlannedPush[] = [];
  for (const p of passengers) {
    if (!p.staffMemberId || !knownStaff.has(p.staffMemberId)) continue;
    const origin      = p.trip.route?.origin      ?? 'your stop';
    const destination = p.trip.route?.destination ?? 'the office';
    const routeName   = p.trip.route?.name        ?? `${origin} → ${destination}`;
    for (const sub of subsByStaff.get(p.staffMemberId) ?? []) {
      pushes.push({
        tenantId,
        subscriptionId: sub.id,
        target: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload: {
          title: `Bus in ${leadMins} min`,
          body:  `${routeName} from ${origin} — boarding soon.`,
          url:   '/bus-ops/passenger/app',
          tag:   `${TICKET_TAG_PREFIX}:${p.tripId}:${p.staffMemberId}`,
          sound: 'default',
          data: {
            type:    'trip-reminder',
            tripId:  p.tripId,
            staffId: p.staffMemberId,
          },
        },
      });
    }
  }
  return { tripsMatched: passengers.length, pushes };
}
