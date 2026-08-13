/**
 * POST /api/push/test — send a test push to the calling staff member's
 * active subscriptions. Used by the PWA to confirm the round-trip works
 * after the user opts in. No production trip data, no scheduling — just
 * a "Hello from Fleet360" notification.
 *
 * Body:
 *   { employeeId: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPush } from '@/lib/push/server';

export async function POST(req: NextRequest) {
  let body: { employeeId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.employeeId) return NextResponse.json({ error: 'employeeId required' }, { status: 400 });

  // The PWA identifies the staff member by employeeId (no admin session).
  // /api/push/ is in PUBLIC_PREFIXES so the middleware skips auth and doesn't
  // set x-tenant-id — we have to look up the tenant from the staff record.
  const staff = await prisma.staffMember.findFirst({
    where: { employeeId: body.employeeId, deletedAt: null },
    select: { id: true, tenantId: true },
  });
  if (!staff) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });
  const tenantId = staff.tenantId;
  if (!tenantId) return NextResponse.json({ error: 'Cannot determine tenant' }, { status: 400 });

  const subs = await prisma.pushSubscription.findMany({
    where: { tenantId, staffMemberId: staff.id, revokedAt: null },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subs.length === 0) {
    return NextResponse.json({ sent: 0, pruned: 0, total: 0, message: 'No active subscriptions for this staff member' });
  }

  const results = await Promise.all(subs.map(async (s) => {
    const r = await sendPush(
      { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
      {
        title: 'Fleet360 test notification',
        body:  'Push notifications are working. You will get a reminder 10 min before each trip.',
        url:   '/bus-ops/passenger/app',
        tag:   'fleet360-test',
        sound: 'default',
        data:  { type: 'test' },
      },
    );
    if (!r.ok && r.reason === 'gone') {
      // Prune dead endpoints
      await prisma.pushSubscription.update({
        where: { id: s.id },
        data: { revokedAt: new Date(), lastErrorAt: new Date(), lastErrorCode: r.statusCode },
      });
    }
    return { subscriptionId: s.id, ...r };
  }));

  const sent = results.filter(r => r.ok).length;
  const pruned = results.filter(r => !r.ok && r.reason === 'gone').length;
  return NextResponse.json({ sent, pruned, total: subs.length, results });
}
